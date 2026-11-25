// AIV-P0-016: Blob storage for uploads. Browsers PUT straight to uploads-quarantine with a 10-minute user-delegation SAS
// for one blob; a clean file is moved to cvs or evidence by the app identity (web and worker share id-aivera-dev).
// Malware scanning (Defender for Storage) is off in dev because of its cost (owner, 20 Nov 2026): the pilot and
// production pass malwareScanning=true, and their apps set MALWARE_SCANNING=on (the web app refuses to start otherwise).
// shortcut: malware scanning off in dev (synthetic data, owner decision 20 Nov 2026); the pilot sets MALWARE_SCANNING=on
param env string
param location string
param tags object
@description('Globally unique account name; main.bicep derives it so the web app can be given its endpoint first.')
param storageName string
@description('The web app FQDN: the only origin allowed to PUT from a browser (CORS).')
param webFqdn string
@description('The app identity (id-aivera-dev), web and worker.')
param appIdentityPrincipalId string
@description('Defender for Storage malware scanning, with its results sent to the worker through Event Grid and Service Bus. Off in dev (cost); on for the pilot and production.')
param malwareScanning bool = false
@description('The Service Bus namespace the scan results queue lives in (modules/messaging.bicep). Used only with malwareScanning.')
param serviceBusNamespaceName string

resource account 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    accessTier: 'Hot'
    // Never a public blob: an admin or recruiter opens a file through one short-lived (5 minutes), audited, read-only
    // signed link the web app issues after its authorisation check (AIV-P1-045).
    allowBlobPublicAccess: false
    // Entra only: no account key exists to leak, so every SAS is a user-delegation SAS signed for the app identity.
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    // shortcut: public endpoint, because browsers upload to it directly; access needs Entra or a SAS. Revisit private
    // endpoints for the server-side traffic with the pilot network (AIV-P5-E03, #34)
    publicNetworkAccess: 'Enabled'
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: account
  name: 'default'
  properties: {
    cors: {
      corsRules: [
        {
          allowedOrigins: ['https://${webFqdn}']
          allowedMethods: ['PUT']
          allowedHeaders: ['content-type', 'x-ms-*']
          exposedHeaders: ['x-ms-request-id']
          maxAgeInSeconds: 3600
        }
      ]
    }
  }
}

// uploads-quarantine holds every upload until the scan; cvs and evidence hold clean files only. `cvs`, not `cv`:
// container names take 3 to 63 characters.
resource containers 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = [
  for name in ['uploads-quarantine', 'cvs', 'evidence']: {
    parent: blobService
    name: name
    properties: { publicAccess: 'None' }
  }
]

// A safety net: anything left in quarantine (an abandoned upload, a move that failed after commit) goes after a day.
resource lifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: account
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'quarantine-expiry'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: { blobTypes: ['blockBlob'], prefixMatch: ['uploads-quarantine/'] }
            actions: { baseBlob: { delete: { daysAfterModificationGreaterThan: 1 } } }
          }
        }
      ]
    }
  }
}

// Storage Blob Data Contributor: read, write and delete blobs. Storage Blob Delegator: get the user delegation key that
// signs upload SAS and the read-only link to one file. Both on this account only.
var blobRoles = ['ba92f5b4-2d11-453d-a403-e96b0029c9fe', 'db58b8e5-c6ad-4a2a-8342-4190687cbf4a']

resource appBlobRoles 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for role in blobRoles: {
    name: guid(account.id, appIdentityPrincipalId, role)
    scope: account
    properties: {
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', role)
      principalId: appIdentityPrincipalId
      principalType: 'ServicePrincipal'
    }
  }
]

// Malware scanning (pilot and production): Defender sends each scan result to an Event Grid topic, whose subscription
// puts it on a Service Bus queue the worker receives from (apps/backend/worker, SCAN_RESULTS_QUEUE). The worker has no ingress.
resource namespace 'Microsoft.ServiceBus/namespaces@2024-01-01' existing = if (malwareScanning) {
  name: serviceBusNamespaceName
}

resource scanQueue 'Microsoft.ServiceBus/namespaces/queues@2024-01-01' = if (malwareScanning) {
  parent: namespace
  name: 'malware-scan-results'
  properties: {
    defaultMessageTimeToLive: 'P14D'
    deadLetteringOnMessageExpiration: true
    maxDeliveryCount: 10
    lockDuration: 'PT1M'
  }
}

resource scanTopic 'Microsoft.EventGrid/topics@2024-06-01-preview' = if (malwareScanning) {
  name: 'evgt-credalent-scan-${env}'
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  // shortcut: the topic keeps its access keys, since Defender's publishing to a key-less topic is not confirmed;
  // whoever can list them could post a forged "No threats found". Try disableLocalAuth: true at the pilot's first
  // apply with scanning on, and keep it if Defender still delivers (AIV-P5-E03, #34)
  properties: { inputSchema: 'EventGridSchema' }
}

// The topic's own identity sends to the queue: the namespace has shared keys off (modules/messaging.bicep).
var dataSender = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '69a216fc-b8fb-44d8-bc22-1f3c2cd27a39')

resource topicSends 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (malwareScanning) {
  name: guid(scanQueue.id, scanTopic.id, dataSender)
  scope: scanQueue
  properties: {
    roleDefinitionId: dataSender
    principalId: scanTopic!.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource scanResults 'Microsoft.EventGrid/topics/eventSubscriptions@2024-06-01-preview' = if (malwareScanning) {
  parent: scanTopic
  name: 'malware-scan-results'
  properties: {
    deliveryWithResourceIdentity: {
      identity: { type: 'SystemAssigned' }
      destination: { endpointType: 'ServiceBusQueue', properties: { resourceId: scanQueue.id } }
    }
    // Quarantine only. shortcut: Defender also scans the worker's copy into cvs or evidence (a second per-GB charge), and a
    // Malicious verdict on that copy is dropped; act on it (mark the file infected) or exclude those containers from scanning
    // before the pilot turns scanning on.
    filter: {
      includedEventTypes: ['Microsoft.Security.MalwareScanningResult']
      advancedFilters: [{ operatorType: 'StringContains', key: 'data.blobUri', values: ['/uploads-quarantine/'] }]
    }
    eventDeliverySchema: 'EventGridSchema'
    retryPolicy: { maxDeliveryAttempts: 30, eventTimeToLiveInMinutes: 1440 }
  }
  dependsOn: [topicSends]
}

resource defender 'Microsoft.Security/defenderForStorageSettings@2022-12-01-preview' = if (malwareScanning) {
  name: 'current'
  scope: account
  properties: {
    isEnabled: true
    overrideSubscriptionLevelSettings: true
    // A monthly cap bounds the per-GB scanning charge. shortcut: the SAS cannot cap an upload's size (up to about 5000 MiB per
    // request), so a recruiter could use up the cap and every workspace's uploads would then stay pending; add a cap-usage
    // alert or a per-workspace upload rate limit before the pilot.
    malwareScanning: { onUpload: { isEnabled: true, capGBPerMonth: 50 }, scanResultsEventGridTopicResourceId: scanTopic.id }
    sensitiveDataDiscovery: { isEnabled: false }
  }
  dependsOn: [scanResults]
}

output accountName string = account.name
