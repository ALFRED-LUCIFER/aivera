// Aivera dev environment (epic AIV-P0-E02). Deployed into Medvya's dev resource group, Central India (ADR-008):
//   az deployment group create -g rg-medvya-dev-in -f infra/main.bicep   (owner only; see infra/README.md)
targetScope = 'resourceGroup'

@description('GitHub repository allowed to deploy with OIDC from main.')
param githubRepo string = 'ALFRED-LUCIFER/aivera'

var location = resourceGroup().location
var tags = { product: 'aivera', env: 'dev', data: 'synthetic' }

// Shared Medvya dev resources, referenced with `existing` and never changed.
var shared = {
  logAnalytics: 'log-medvya-dev-3afs7i'
}

module foundation 'modules/foundation.bicep' = {
  name: 'aivera-foundation'
  params: {
    location: location
    tags: tags
    logAnalyticsName: shared.logAnalytics
    githubRepo: githubRepo
  }
}

output appIdentityClientId string = foundation.outputs.appIdentityClientId
output cicdIdentityClientId string = foundation.outputs.cicdIdentityClientId
output keyVaultName string = foundation.outputs.keyVaultName
