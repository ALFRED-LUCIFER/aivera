// AIV-P0-005: the Aivera web app in Aivera's external environment cae-aivera-dev (ADR-008). Consumption, scale to zero.
// shortcut: no Front Door and no custom domain in dev; the public default FQDN serves it. Front Door, a dev host and portfolio subdomains come with the launch epic AIV-P5-E03 (#34)
// shortcut: public with no sign-in until AIV-P0-009/010; the recruiter app's dev stand-in member exists only under `next dev`, so /app 404s in this production build, and dev holds synthetic data only
param location string
param tags object
param containerAppsEnvName string
param appIdentityId string
param appIdentityClientId string
param appInsightsSecretUri string
param databaseHost string
param databaseName string
param webImage string
param commitSha string

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: containerAppsEnvName
}

var probe = { port: 3000, scheme: 'HTTP' }

resource web 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-aivera-web-dev'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${appIdentityId}': {} }
  }
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
      }
      // Every secret is a Key Vault reference read with the app identity; no literal secret lives on the app.
      secrets: [
        { name: 'appinsights-connection-string', keyVaultUrl: appInsightsSecretUri, identity: appIdentityId }
      ]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: webImage
          env: [
            { name: 'APP_ENV', value: 'dev' }
            { name: 'COMMIT_SHA', value: commitSha }
            // No password: packages/db signs in as aivera_app with the identity's Entra token.
            {
              name: 'DATABASE_URL'
              value: 'postgres://aivera_app@${databaseHost}:5432/${databaseName}?sslmode=verify-full'
            }
            { name: 'AZURE_CLIENT_ID', value: appIdentityClientId }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', secretRef: 'appinsights-connection-string' }
          ]
          resources: { cpu: json('0.5'), memory: '1Gi' }
          probes: [
            { type: 'Liveness', httpGet: union(probe, { path: '/api/health' }), periodSeconds: 30 }
            { type: 'Readiness', httpGet: union(probe, { path: '/api/ready' }), periodSeconds: 10, timeoutSeconds: 3 }
          ]
        }
      ]
      scale: { minReplicas: 0, maxReplicas: 1 }
    }
  }
}

output webFqdn string = web.properties.configuration.ingress.fqdn
