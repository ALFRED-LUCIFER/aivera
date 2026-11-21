// AIV-P1-096: what dev borrows from Medvya, owned by the pilot itself (real candidate data, AGENTS.md 1.10): Log Analytics,
// a VNet and a PostgreSQL server with private access only. Deployed only when env is not dev (main.bicep).
// Both subnets are declared inline, so a re-apply never removes the one the Container Apps environment uses.
param location string
param tags object
param env string
@description('aivera on dev (its live names), credalent elsewhere: the prefix of every name (main.bicep).')
param brand string
param logAnalyticsName string
param vnetName string
@description('The VNet address space; the environment and PostgreSQL subnets are carved from its start.')
param vnetPrefix string
param postgresServerName string
param postgresSku string
param backupRetentionDays int

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: vnetName
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: [vnetPrefix] }
    subnets: [
      {
        // The same name and settings modules/environment.bicep gives dev's subnet; /27 is the consumption minimum.
        name: 'snet-${brand}-${env}'
        properties: {
          addressPrefix: cidrSubnet(vnetPrefix, 27, 0)
          privateEndpointNetworkPolicies: 'Disabled'
          delegations: [{ name: 'containerapps', properties: { serviceName: 'Microsoft.App/environments' } }]
        }
      }
      {
        name: 'snet-${brand}-${env}-psql'
        properties: {
          addressPrefix: cidrSubnet(vnetPrefix, 28, 2)
          delegations: [
            { name: 'postgres', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } }
          ]
        }
      }
    ]
  }
}

// A VNet-integrated server resolves through a private zone whose name ends in .postgres.database.azure.com.
resource dnsZone 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: '${postgresServerName}.private.postgres.database.azure.com'
  location: 'global'
  tags: tags

  resource link 'virtualNetworkLinks' = {
    name: vnetName
    location: 'global'
    tags: tags
    properties: { virtualNetwork: { id: vnet.id }, registrationEnabled: false }
  }
}

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: postgresServerName
  location: location
  tags: tags
  sku: { name: postgresSku, tier: 'Burstable' }
  properties: {
    version: '16'
    storage: { storageSizeGB: 32, autoGrow: 'Enabled' }
    // Backups stay in region: geo-redundant backup would copy them to the paired region (AGENTS.md 1.10).
    backup: { backupRetentionDays: backupRetentionDays, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    // A server in a delegated subnet has no public endpoint at all (publicNetworkAccess is not set: Azure derives it).
    network: {
      delegatedSubnetResourceId: vnet.properties.subnets[1].id
      privateDnsZoneArmResourceId: dnsZone.id
    }
    // Entra sign-in only, as on dev: roles map to managed identities (infra/sql/bootstrap-roles.sql). The owner adds
    // themselves as Entra admin after the apply (docs/runbooks/pilot-environment.md).
    authConfig: { activeDirectoryAuth: 'Enabled', passwordAuth: 'Disabled', tenantId: tenant().tenantId }
  }
  dependsOn: [dnsZone::link]
}

// pgvector for the search schema (AIV-P0-030); the bootstrap creates it as an Entra admin.
resource extensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: server
  name: 'azure.extensions'
  properties: { value: 'VECTOR', source: 'user-override' }
}
