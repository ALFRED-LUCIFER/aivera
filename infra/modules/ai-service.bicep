// AIV-P2-068: the Python AI service (apps/backend/ai-service, ADR-015). Internal ingress only: reachable from apps in
// this Container Apps environment, refused from outside it. Every task call must also carry a token for the service's
// app registration from an allowed identity (the web app's); the probes are the only routes without one.
// Its own identity (main.bicep) may call the AI deployments and nothing else: no database role, no connection string,
// no Key Vault secret.
// shortcut: the environment's subnet can still reach PostgreSQL; the service holds no credential for it. Give the
// service its own environment and subnet with no route to the database if a task ever needs untrusted code or tools.
param env string
@description('aivera on dev (its live names), credalent elsewhere: the prefix of every name (main.bicep).')
param brand string
param location string
param tags object
param containerAppsEnvName string
param image string
@description('The service\'s own identity (main.bicep): Cognitive Services OpenAI User on the AI resource only.')
param identityId string
param identityClientId string
@description('The service\'s app registration: the audience every caller\'s token must carry (infra/README.md).')
param audience string
@description('Object ids of the identities allowed to call a task: the web app\'s.')
param allowedCallers array
param aiResourceName string

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: containerAppsEnvName
}

var name = 'ca-${brand}-ai-${env}'
var probe = { port: 8080, scheme: 'HTTP' }

resource service 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identityId}': {} }
  }
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: false, targetPort: 8080, transport: 'http', allowInsecure: false }
    }
    template: {
      containers: [
        {
          name: 'ai-service'
          image: image
          env: [
            { name: 'AZURE_CLIENT_ID', value: identityClientId }
            // The workforce tenant that issues the managed identities' tokens, not the External ID tenant.
            { name: 'AZURE_TENANT_ID', value: tenant().tenantId }
            { name: 'AI_SERVICE_AUDIENCE', value: audience }
            { name: 'AI_SERVICE_ALLOWED_CALLERS', value: join(allowedCallers, ',') }
            { name: 'AZURE_OPENAI_RESOURCE_NAME', value: aiResourceName }
            { name: 'AI_DEPLOYMENT', value: 'gpt-main' }
          ]
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          probes: [
            { type: 'Liveness', httpGet: union(probe, { path: '/healthz' }), periodSeconds: 30 }
            { type: 'Readiness', httpGet: union(probe, { path: '/readyz' }), periodSeconds: 10, timeoutSeconds: 5 }
          ]
        }
      ]
      // shortcut: scales to zero in dev, so the first question after a quiet spell waits for a cold start (a few
      // seconds, within the client's 60 s timeout); keep one replica in the pilot if that wait shows.
      scale: { minReplicas: 0, maxReplicas: 2 }
    }
  }
}

output url string = 'https://${service.properties.configuration.ingress.fqdn}'
