// Aivera dev environment (epic AIV-P0-E02). Deployed into Medvya's dev resource group, Central India (ADR-008):
//   az deployment group create -g rg-medvya-dev-in -n aivera-dev --mode Incremental -f infra/main.bicep -p imageTag=<sha>
// Owner only (infra/README.md). Never --mode Complete: the resource group is Medvya's, and Complete deletes everything
// this template does not declare.
targetScope = 'resourceGroup'

@description('GitHub repository allowed to deploy with OIDC from main.')
param githubRepo string = 'ALFRED-LUCIFER/aivera'

@description('Commit SHA tag of the images on ghcr.io to run. Pass the one running now so a redeploy changes nothing.')
param imageTag string

var location = resourceGroup().location
var tags = { product: 'aivera', env: 'dev', data: 'synthetic' }
var images = 'ghcr.io/${toLower(githubRepo)}'

// Shared Medvya dev resources, referenced with `existing` and never changed.
var shared = {
  logAnalytics: 'log-medvya-dev-3afs7i'
  postgresServer: 'psql-medvya-dev-3afs7i'
  containerAppsEnv: 'cae-medvya-dev-3afs7i'
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

module database 'modules/database.bicep' = {
  name: 'aivera-database'
  params: {
    location: location
    tags: tags
    postgresServerName: shared.postgresServer
    containerAppsEnvName: shared.containerAppsEnv
    cicdIdentityId: foundation.outputs.cicdIdentityId
    cicdIdentityClientId: foundation.outputs.cicdIdentityClientId
    migrateImage: '${images}/migrate:${imageTag}'
  }
}

output appIdentityClientId string = foundation.outputs.appIdentityClientId
output cicdIdentityClientId string = foundation.outputs.cicdIdentityClientId
output keyVaultName string = foundation.outputs.keyVaultName
