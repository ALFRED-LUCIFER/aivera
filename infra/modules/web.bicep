// AIV-P0-005: the Credalent web app in Credalent's external environment cae-aivera-dev (ADR-008). Consumption, scale to zero.
// shortcut: no Front Door and no custom domain in dev; the public default FQDN serves it. Front Door, a dev host and portfolio subdomains come with the launch epic AIV-P5-E03 (#34)
param env string
@description(q{aivera on dev (its live names), credalent elsewhere: the prefix of every name (main.bicep).})
param brand string
param location string
param tags object
param containerAppsEnvName string
param appIdentityId string
param appIdentityClientId string
param appInsightsSecretUri string
@description('Credalent Key Vault URI (ends with a slash); recruiter sign-in secrets live there (docs/runbooks/recruiter-sign-in.md).')
param keyVaultUri string
param databaseHost string
param databaseName string
param webImage string
param aiResourceName string
param commitSha string
param entraTenantSubdomain string
param entraTenantId string
param entraRecruiterClientId string
@description('Candidate app registration (client) id in the dev External ID tenant (docs/runbooks/candidate-sign-in.md). Empty until the owner registers it: the candidate settings are then left out and candidate sign-in stays off.')
param entraCandidateClientId string = ''
@description('Google OAuth client id for recruiter "Continue with Google" (AIV-P0-928, docs/runbooks/recruiter-sign-in.md). Empty until the owner creates it and writes google-client-secret to the vault: the Google button stays hidden.')
param googleClientId string = ''
@description('The uploads storage account\'s blob endpoint (modules/storage.bicep, AIV-P0-016).')
param blobUrl string
@description('Whether Defender scans uploads; off in dev only (owner, 20 Nov 2026).')
param malwareScanning bool

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: containerAppsEnvName
}

var probe = { port: 3000, scheme: 'HTTP' }
var appName = 'ca-${brand}-web-${env}'
// Candidate sign-in (AIV-P0-011): added only once the app exists, since an apply fails on a missing Key Vault secret.
var candidateSecrets = empty(entraCandidateClientId)
  ? []
  : [
      {
        name: 'entra-candidate-client-secret'
        keyVaultUrl: '${keyVaultUri}secrets/entra-candidate-client-secret'
        identity: appIdentityId
      }
    ]
var candidateEnv = empty(entraCandidateClientId)
  ? []
  : [
      { name: 'AUTH_ENTRA_CANDIDATE_CLIENT_ID', value: entraCandidateClientId }
      { name: 'AUTH_ENTRA_CANDIDATE_CLIENT_SECRET', secretRef: 'entra-candidate-client-secret' }
    ]
// Google sign-in (AIV-P0-928): added only once the client exists, for the same reason.
var googleSecrets = empty(googleClientId)
  ? []
  : [{ name: 'google-client-secret', keyVaultUrl: '${keyVaultUri}secrets/google-client-secret', identity: appIdentityId }]
var googleEnv = empty(googleClientId)
  ? []
  : [
      { name: 'AUTH_GOOGLE_CLIENT_ID', value: googleClientId }
      { name: 'AUTH_GOOGLE_CLIENT_SECRET', secretRef: 'google-client-secret' }
    ]

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
      secrets: concat([
        { name: 'appinsights-connection-string', keyVaultUrl: appInsightsSecretUri, identity: appIdentityId }
        // Recruiter sign-in (AIV-P0-009). Both secrets must exist in the vault before an apply.
        {
          name: 'entra-recruiter-client-secret'
          keyVaultUrl: '${keyVaultUri}secrets/entra-recruiter-client-secret'
          identity: appIdentityId
        }
        { name: 'auth-secret', keyVaultUrl: '${keyVaultUri}secrets/auth-secret', identity: appIdentityId }
        // Operator console (AIV-P2-035, ADR-012): the operators' emails. Must exist in the vault before an apply, or the
        // revision fails to start (docs/runbooks/operator-console.md).
        {
          name: 'platform-operator-emails'
          keyVaultUrl: '${keyVaultUri}secrets/platform-operator-emails'
          identity: appIdentityId
        }
        // ACS delivery-report webhook key (AIV-P0-017). Must exist in the vault before an apply.
        { name: 'acs-webhook-key', keyVaultUrl: '${keyVaultUri}secrets/acs-webhook-key', identity: appIdentityId }
        // The send log's column key (AIV-P0-017): the web app seals the invitation emails it queues (AIV-P1-003).
        {
          name: 'notifications-encryption-key'
          keyVaultUrl: '${keyVaultUri}secrets/notifications-encryption-key'
          identity: appIdentityId
        }
      ], candidateSecrets, googleSecrets)
    }
    template: {
      containers: [
        {
          name: 'web'
          image: webImage
          env: concat([
            // pilot turns off synthetic-only behaviour (the email band, fake AI) and requires sign-in and scanning.
            { name: 'APP_ENV', value: env }
            { name: 'COMMIT_SHA', value: commitSha }
            // No password: packages/db signs in as aivera_app with the identity's Entra token.
            {
              name: 'DATABASE_URL'
              value: 'postgres://aivera_app@${databaseHost}:5432/${databaseName}?sslmode=verify-full'
            }
            { name: 'AZURE_CLIENT_ID', value: appIdentityClientId }
            // @credalent/ai calls https://<name>.openai.azure.com with the identity's token (AIV-P0-034).
            { name: 'AZURE_OPENAI_RESOURCE_NAME', value: aiResourceName }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', secretRef: 'appinsights-connection-string' }
            // The External ID tenant and its recruiter app registration (not secrets; main.bicep).
            { name: 'AUTH_ENTRA_TENANT_SUBDOMAIN', value: entraTenantSubdomain }
            { name: 'AUTH_ENTRA_TENANT_ID', value: entraTenantId }
            { name: 'AUTH_ENTRA_CLIENT_ID', value: entraRecruiterClientId }
            { name: 'AUTH_ENTRA_CLIENT_SECRET', secretRef: 'entra-recruiter-client-secret' }
            { name: 'AUTH_SECRET', secretRef: 'auth-secret' }
            { name: 'PLATFORM_OPERATOR_EMAILS', secretRef: 'platform-operator-emails' }
            { name: 'ACS_WEBHOOK_KEY', secretRef: 'acs-webhook-key' }
            { name: 'NOTIFICATIONS_ENCRYPTION_KEY', secretRef: 'notifications-encryption-key' }
            // The public origin: the container listens on 0.0.0.0:3000, so without this Auth.js redirects to https://0.0.0.0:3000.
            { name: 'AUTH_URL', value: 'https://${appName}.${environment.properties.defaultDomain}' }
            // Uploads (AIV-P0-016). With scanning off the web app settles uploads itself after re-checking the blob.
            { name: 'AZURE_STORAGE_BLOB_URL', value: blobUrl }
            { name: 'MALWARE_SCANNING', value: malwareScanning ? 'on' : 'off' }
          ], candidateEnv, googleEnv)
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
