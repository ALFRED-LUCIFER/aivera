// AIV-P0-006: what GitHub Actions (id-aivera-cicd-dev, OIDC) may do, and nothing more. Every assignment is scoped to
// one Credalent resource (the web and worker apps, the job, Credalent's own environment, Credalent's identities): never the resource group,
// never a Medvya resource.
param env string
param cicdPrincipalId string
param containerAppsEnvName string

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: containerAppsEnvName
}
resource web 'Microsoft.App/containerApps@2024-03-01' existing = {
  name: 'ca-aivera-web-${env}'
}
resource worker 'Microsoft.App/containerApps@2024-03-01' existing = {
  name: 'ca-aivera-worker-${env}'
}
resource migrateJob 'Microsoft.App/jobs@2024-03-01' existing = {
  name: 'job-aivera-migrate-${env}'
}
resource appIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: 'id-aivera-${env}'
}
resource relayIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: 'id-aivera-relay-${env}'
}
resource cicdIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: 'id-aivera-cicd-${env}'
}

var contributor = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b24988ac-6180-42a0-ab88-20f7382dd24c')

// Updating an app or job re-submits its environment and identities, which ARM checks as join and assign actions.
resource deployerRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: guid(resourceGroup().id, 'aivera-${env}-deployer')
  properties: {
    roleName: 'Credalent ${env} deployer'
    description: 'Join the Credalent ${env} Container Apps environment and assign Credalent identities when deploying Credalent ${env}.'
    type: 'CustomRole'
    assignableScopes: [resourceGroup().id]
    permissions: [
      {
        actions: [
          'Microsoft.App/managedEnvironments/read'
          'Microsoft.App/managedEnvironments/join/action'
          'Microsoft.ManagedIdentity/userAssignedIdentities/read'
          'Microsoft.ManagedIdentity/userAssignedIdentities/assign/action'
        ]
        notActions: []
      }
    ]
  }
}

resource onWeb 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(web.id, cicdPrincipalId, contributor)
  scope: web
  properties: { roleDefinitionId: contributor, principalId: cicdPrincipalId, principalType: 'ServicePrincipal' }
}

resource onJob 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(migrateJob.id, cicdPrincipalId, contributor)
  scope: migrateJob
  properties: { roleDefinitionId: contributor, principalId: cicdPrincipalId, principalType: 'ServicePrincipal' }
}

resource onEnvironment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(environment.id, cicdPrincipalId, deployerRole.id)
  scope: environment
  properties: { roleDefinitionId: deployerRole.id, principalId: cicdPrincipalId, principalType: 'ServicePrincipal' }
}

resource onAppIdentity 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(appIdentity.id, cicdPrincipalId, deployerRole.id)
  scope: appIdentity
  properties: { roleDefinitionId: deployerRole.id, principalId: cicdPrincipalId, principalType: 'ServicePrincipal' }
}

resource onCicdIdentity 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(cicdIdentity.id, cicdPrincipalId, deployerRole.id)
  scope: cicdIdentity
  properties: { roleDefinitionId: deployerRole.id, principalId: cicdPrincipalId, principalType: 'ServicePrincipal' }
}

// AIV-P0-015: the worker app, which runs with the app and relay identities.
resource onWorker 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(worker.id, cicdPrincipalId, contributor)
  scope: worker
  properties: { roleDefinitionId: contributor, principalId: cicdPrincipalId, principalType: 'ServicePrincipal' }
}

resource onRelayIdentity 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(relayIdentity.id, cicdPrincipalId, deployerRole.id)
  scope: relayIdentity
  properties: { roleDefinitionId: deployerRole.id, principalId: cicdPrincipalId, principalType: 'ServicePrincipal' }
}
