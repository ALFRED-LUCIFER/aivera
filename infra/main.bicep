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
  vnet: 'vnet-medvya-dev-3afs7i'
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

// Aivera's external environment on a new subnet of Medvya's VNet (10.20.5.0/27 is free: Medvya uses 10.20.1.0/24,
// 10.20.2.0/24 and 10.20.4.0/27 of 10.20.0.0/16, checked 18 Nov 2026). /27 is the minimum for a consumption environment.
module environment 'modules/environment.bicep' = {
  name: 'aivera-environment'
  params: {
    location: location
    tags: tags
    vnetName: shared.vnet
    subnetPrefix: '10.20.5.0/27'
    logAnalyticsName: shared.logAnalytics
  }
}

module database 'modules/database.bicep' = {
  name: 'aivera-database'
  params: {
    location: location
    tags: tags
    postgresServerName: shared.postgresServer
    containerAppsEnvName: environment.outputs.environmentName
    cicdIdentityId: foundation.outputs.cicdIdentityId
    cicdIdentityClientId: foundation.outputs.cicdIdentityClientId
    migrateImage: '${images}/migrate:${imageTag}'
  }
}

module web 'modules/web.bicep' = {
  name: 'aivera-web'
  params: {
    location: location
    tags: tags
    containerAppsEnvName: environment.outputs.environmentName
    appIdentityId: foundation.outputs.appIdentityId
    appIdentityClientId: foundation.outputs.appIdentityClientId
    appInsightsSecretUri: foundation.outputs.appInsightsSecretUri
    databaseHost: database.outputs.databaseHost
    databaseName: database.outputs.databaseName
    webImage: '${images}/web:${imageTag}'
    commitSha: imageTag
  }
}

output webFqdn string = web.outputs.webFqdn
output appIdentityClientId string = foundation.outputs.appIdentityClientId
output cicdIdentityClientId string = foundation.outputs.cicdIdentityClientId
output keyVaultName string = foundation.outputs.keyVaultName
