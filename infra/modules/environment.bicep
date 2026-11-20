// Credalent's own external Container Apps environment (owner decision 18 Nov 2026, ADR-008): consumption only, free, on a
// new subnet of Medvya's VNet so it reaches the shared PostgreSQL server privately. The private DNS zone
// medvya-dev-3afs7i.private.postgres.database.azure.com is linked to the whole VNet, so it resolves from this subnet.
param location string
param tags object
param vnetName string
param subnetPrefix string
param logAnalyticsName string

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' existing = {
  name: vnetName
}

// A subnet is its own child resource: this PUT creates or updates only this subnet and leaves the VNet's address space,
// DNS, peerings and Medvya's subnets untouched. Medvya's VNet itself is never declared here.
resource subnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {
  parent: vnet
  name: 'snet-aivera-dev'
  properties: {
    addressPrefix: subnetPrefix
    // Pinned to the live value (checked 19 Nov 2026): left out, a re-apply would flip it to Enabled.
    privateEndpointNetworkPolicies: 'Disabled'
    delegations: [
      { name: 'containerapps', properties: { serviceName: 'Microsoft.App/environments' } }
    ]
  }
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: logAnalyticsName
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-aivera-dev'
  location: location
  tags: tags
  properties: {
    vnetConfiguration: { infrastructureSubnetId: subnet.id, internal: false }
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

output environmentName string = environment.name
