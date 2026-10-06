// Deterministic READ COMMITTED harness: independent clients, staged writes,
// transaction locks and unique-key waits. It is not a SQL engine; unknown SQL fails.
export class InterleavingPool {
  constructor() {
    this.tables = Object.fromEntries(['projects', 'idempotency_records', 'approval_decisions', 'audit_log', 'outbox'].map(t => [t, new Map()]))
    this.locks = new Map()
    this.queries = []
    this.waits = []
    this.clients = []
  }
  async connect() {
    const client = { pending: null, held: new Set(), released: false }
    client.query = (sql, params = []) => this.query(sql, params, client)
    client.release = () => { client.released = true }
    this.clients.push(client)
    return client
  }
  async lock(client, key) {
    if (client.held.has(key)) return
    while (this.locks.has(key)) {
      this.waits.push(key)
      this.onWait?.(key)
      await this.locks.get(key).done
    }
    let release
    const done = new Promise(resolve => { release = resolve })
    this.locks.set(key, { done, release })
    client.held.add(key)
  }
  finish(client, commit) {
    if (commit) for (const [table, entries] of client.pending) {
      for (const [key, value] of entries) this.tables[table].set(key, value)
    }
    client.pending = null
    for (const key of client.held) {
      const lock = this.locks.get(key)
      this.locks.delete(key)
      lock.release()
    }
    client.held.clear()
  }
  view(table, client) {
    return new Map([...this.tables[table], ...(client?.pending?.get(table) ?? [])])
  }
  async insert(table, key, value, client) {
    if (client?.pending) await this.lock(client, `unique:${table}:${key}`)
    if (this.view(table, client).has(key)) return { rows: [] }
    this.store(table, key, value, client)
    return { rows: [structuredClone(value)] }
  }
  store(table, key, value, client) {
    if (client?.pending) {
      if (!client.pending.has(table)) client.pending.set(table, new Map())
      client.pending.get(table).set(key, value)
    } else this.tables[table].set(key, value)
  }
  async query(sql, params = [], client = null) {
    const text = String(sql).replace(/\s+/g, ' ').trim()
    this.queries.push({ text, params: structuredClone(params), client })
    if (/^BEGIN(?: ISOLATION LEVEL READ COMMITTED)?$/.test(text)) {
      client.pending = new Map()
      return { rows: [] }
    }
    if (text === 'COMMIT' || text === 'ROLLBACK') {
      this.finish(client, text === 'COMMIT')
      return { rows: [] }
    }
    if (text.startsWith('SELECT pg_advisory_xact_lock(')) {
      if (!client?.pending) throw new Error('transaction lock outside transaction')
      await this.lock(client, `advisory:${JSON.stringify(params)}`)
      return { rows: [] }
    }
    if (text.startsWith('INSERT INTO dramago.projects')) {
      const [tenant, workspace, id, revision, json] = params
      return this.insert('projects', id, { tenant, workspace, revision, body: JSON.parse(json) }, client)
    }
    if (text.startsWith('SELECT body FROM dramago.projects')) {
      const row = this.view('projects', client).get(params[1])
      return { rows: row?.tenant === params[0] ? [structuredClone(row)] : [] }
    }
    if (text.startsWith('UPDATE dramago.projects')) {
      const [revision, json, tenant, id, expected] = params
      await this.lock(client, `unique:projects:${id}`)
      const row = this.view('projects', client).get(id)
      if (!row || row.tenant !== tenant || row.revision !== expected) return { rows: [] }
      const next = { ...row, revision, body: JSON.parse(json) }
      this.store('projects', id, next, client)
      return { rows: [structuredClone(next)] }
    }
    if (text.startsWith('INSERT INTO dramago.idempotency_records')) {
      const [tenant, scope, key, payload_hash, result] = params
      return this.insert('idempotency_records', JSON.stringify([tenant, scope, key]), { payload_hash, result: JSON.parse(result) }, client)
    }
    if (text.startsWith('SELECT payload_hash,result FROM dramago.idempotency_records')) {
      const row = this.view('idempotency_records', client).get(JSON.stringify(params))
      return { rows: row ? [structuredClone(row)] : [] }
    }
    if (text.startsWith('INSERT INTO dramago.approval_decisions')) {
      const [tenant, , , id, , , , json] = params
      return this.insert('approval_decisions', id, { tenant, body: JSON.parse(json) }, client)
    }
    if (text.startsWith('SELECT body FROM dramago.approval_decisions')) {
      let records = [...this.view('approval_decisions', client).values()].filter(row => row.tenant === params[0])
      if (text.includes('approval_id=$2')) records = records.filter(row => row.body.approval_id === params[1])
      else if (text.includes('version_id=$2')) records = records.filter(row => row.body.version_id === params[1])
      else if (text.includes('target_refs @> $2::jsonb')) {
        const refs = JSON.parse(params[1])
        records = records.filter(row => refs.every(ref => row.body.target_refs.some(target => Object.keys(ref).every(k => target[k] === ref[k]))))
      } else throw new Error('Unhandled approval lookup: ' + text)
      return { rows: structuredClone(records) }
    }
    if (text.startsWith('INSERT INTO dramago.audit_log') || text.startsWith('INSERT INTO dramago.outbox')) {
      const table = text.includes('dramago.audit_log') ? 'audit_log' : 'outbox'
      const [event_id, tenant] = params
      return this.insert(table, event_id, { event_id, tenant, body: JSON.parse(params.at(-1)) }, client)
    }
    throw new Error('Unhandled SQL in interleaving harness: ' + text)
  }
}
