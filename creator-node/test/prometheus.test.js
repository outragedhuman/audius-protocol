const assert = require('assert')
const request = require('supertest')

const { getApp } = require('./lib/app')
const { getLibsMock } = require('./lib/libsMock')

const { NamespacePrefix } = require('../src/services/prometheusMonitoring/prometheus.constants')

describe('test Prometheus metrics', async function () {
  let app, server, libsMock

  /** Setup app + global test vars */
  beforeEach(async function () {
    libsMock = getLibsMock()

    const appInfo = await getApp(libsMock)
    app = appInfo.app
    server = appInfo.server
  })

  afterEach(async function () {
    await server.close()
  })

  it('Checks that GET /prometheus_metrics is healthy and exposes Default metrics', async function () {
    await request(app).get('/health_check')
    await request(app).get('/health_check')
    await request(app).get('/users/clock_status')

    const resp = await request(app)
      .get('/prometheus_metrics')
      .expect(200)
    console.log(`sidtest resp: ${resp.text}`)

    assert.ok(resp.text.includes(NamespacePrefix + 'default_' + 'process_cpu_user_seconds_total'))

    assert.ok(resp.text.includes(NamespacePrefix + 'http_request_duration_seconds'))
  })
})
