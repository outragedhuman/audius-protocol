// this script generates prometheus.yml dynamically
// it uses audiusLibs to add known service providers to prometheus.yml

const fs = require('fs');
const dotenv = require('dotenv');
const AudiusLibs = require("@audius/libs");


const generatePrometheusYaml = (url, env, scheme = 'https', component = 'discover-provider') => {
  url = url.replace("https://", "");
  url = url.replace("http://", "");

  sanitizedUrl = url.split(".").join("-")

  return `
  - job_name: '${sanitizedUrl}'
    scheme: '${scheme}'
    metrics_path: '/prometheus_metrics'
    static_configs:
      - targets: ['${url}']
        labels:
          host: '${url}'
          environment: '${env}'
          service: 'audius'
          component: '${component}'
`
}

const main = async () => {

  const stream = fs.createWriteStream('prometheus.yml', { flags: 'a' });

  stream.write(`
global:
  scrape_interval:     30s
  evaluation_interval: 15s
  # scrape_timeout is set to the global default (10s).

scrape_configs:
  # monitor itself

  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']
  `)

  if (process.env.PROM_ENV === "local") {
    stream.write(`
  # monitor docker-compose local setups

  - job_name: 'local-discovery-provider'
    metrics_path: '/prometheus_metrics'
    static_configs:
      - targets: ['host.docker.internal:5000']
        labels:
          host: 'host.docker.internal'
          environment: '${process.env.PROM_ENV}'
          service: 'audius'
          component: 'discover-provider'

  # monitor load tests locally

  - job_name: 'load-test-populate'
    metrics_path: '/metrics'
    static_configs:
      - targets: ['host.docker.internal:8000']
        labels:
          host: 'host.docker.internal'
          environment: 'load-test'
          service: 'audius'
          component: 'discover-provider'
          job: 'populate'
    `)

    const localCNs = ['host.docker.internal:4000', 'host.docker.internal:4001', 'host.docker.internal:4002', 'host.docker.internal:4003']
    for (const localCN of localCNs) {
      const yamlString = generatePrometheusYaml(localCN, process.env.PROM_ENV, 'http', 'content-node')
      stream.write(yamlString);
      stream.write("\n")
    }
  }

  stream.end();
}

main()