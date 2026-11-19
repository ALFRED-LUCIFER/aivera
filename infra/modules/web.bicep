// AIV-P0-005: the Aivera web app in Aivera's external environment cae-aivera-dev (ADR-008). Consumption, scale to zero.
// shortcut: no Front Door and no custom domain in dev; the public default FQDN serves it. Front Door, a dev host and portfolio subdomains come with the launch epic AIV-P5-E03 (#34)
param location string
param tags object
param containerAppsEnvName string
param appIdentityId string
param appIdentityClientId string
param appInsightsSecretUri string
@description('Aivera Key Vault URI (ends with a slash); recruiter sign-in secrets live there (docs/runbooks/recruiter-sign-in.md).')
param keyVaultUri string
param databaseHost string
param databaseName string
param webImage string
param aiResourceName string
param commitSha string

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: containerAppsEnvName
}

var probe = { port: 3000, scheme: 'HTTP' }
var appName = 'ca-aivera-web-dev'

resource web 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
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
        // Recruiter sign-in (AIV-P0-009). Both secrets must exist in the vault before an apply.
        {
          name: 'entra-recruiter-client-secret'
          keyVaultUrl: '${keyVaultUri}secrets/entra-recruiter-client-secret'
          identity: appIdentityId
        }
        { name: 'auth-secret', keyVaultUrl: '${keyVaultUri}secrets/auth-secret', identity: appIdentityId }
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
            // @aivera/ai calls https://<name>.openai.azure.com with the identity's token (AIV-P0-034).
            { name: 'AZURE_OPENAI_RESOURCE_NAME', value: aiResourceName }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', secretRef: 'appinsights-connection-string' }
            // The dev External ID tenant and its recruiter app registration (not secrets).
            // shortcut: dev tenant values written in the module; make them params when a pilot environment is added
            { name: 'AUTH_ENTRA_TENANT_SUBDOMAIN', value: 'aiveradev' }
            { name: 'AUTH_ENTRA_TENANT_ID', value: '88c795fc-1018-45f7-8904-75e1c2991b8f' }
            { name: 'AUTH_ENTRA_CLIENT_ID', value: '463fb57b-570d-4384-b914-1078df012bd8' }
            { name: 'AUTH_ENTRA_CLIENT_SECRET', secretRef: 'entra-recruiter-client-secret' }
            { name: 'AUTH_SECRET', secretRef: 'auth-secret' }
            // The public origin: the container listens on 0.0.0.0:3000, so without this Auth.js redirects to https://0.0.0.0:3000.
            { name: 'AUTH_URL', value: 'https://${appName}.${environment.properties.defaultDomain}' }
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
