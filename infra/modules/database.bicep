// AIV-P0-004: Aivera's database on Medvya's shared dev PostgreSQL server, and the migration job in Aivera's VNet-joined
// environment (ADR-008).
// The server, its network and its parameters are Medvya's: referenced, never changed. Roles: infra/sql/bootstrap-roles.sql.
param location string
param tags object
param postgresServerName string
param containerAppsEnvName string
param cicdIdentityId string
param cicdIdentityClientId string
param migrateImage string

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' existing = {
  name: postgresServerName
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: server
  name: 'aivera'
  // Exactly the values the database was created with on 18 Nov 2026 (checked read-only): a deployment is a no-op on it.
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: containerAppsEnvName
}

// Runs `pnpm db:migrate` as aivera_migrator from inside the VNet (the server has no public access). Started by the
// deploy workflow before a new web revision (AIV-P0-006); a failed execution stops the deploy.
resource migrateJob 'Microsoft.App/jobs@2024-03-01' = {
  name: 'job-aivera-migrate-dev'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${cicdIdentityId}': {} }
  }
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      replicaTimeout: 600
      replicaRetryLimit: 0
    }
    template: {
      containers: [
        {
          name: 'migrate'
          image: migrateImage
          env: [
            // No password: packages/db signs in with the identity's Entra token.
            {
              name: 'DATABASE_MIGRATOR_URL'
              value: 'postgres://aivera_migrator@${server.properties.fullyQualifiedDomainName}:5432/${database.name}?sslmode=verify-full'
            }
            { name: 'AZURE_CLIENT_ID', value: cicdIdentityClientId }
          ]
          resources: { cpu: json('0.5'), memory: '1Gi' }
        }
      ]
    }
  }
}

output databaseHost string = server.properties.fullyQualifiedDomainName
output databaseName string = database.name
