// Credalent's own external Container Apps environment (owner decision 18 Nov 2026, ADR-008): consumption only, free, on a
// new subnet of Medvya's VNet so it reaches the shared PostgreSQL server privately. The private DNS zone
// medvya-dev-3afs7i.private.postgres.database.azure.com is linked to the whole VNet, so it resolves from this subnet.
// The pilot (AIV-P1-096) owns its VNet, which declares this subnet inline (modules/network.bicep): subnetPrefix is empty.
param location string
param tags object
param env string
param vnetName string
@description('Prefix of the subnet to add to a VNet that is not ours (dev); empty when the VNet already declares it.')
param subnetPrefix string
param logAnalyticsName string

var subnetName = 'snet-aivera-${env}'

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' existing = {
  name: vnetName
}

// A subnet is its own child resource: this PUT creates or updates only this subnet and leaves the VNet's address space,
// DNS, peerings and Medvya's subnets untouched. Medvya's VNet itself is never declared here.
resource subnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = if (!empty(subnetPrefix)) {
  parent: vnet
  name: subnetName
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
  name: 'cae-aivera-${env}'
  location: location
  tags: tags
  properties: {
    vnetConfiguration: {
      infrastructureSubnetId: resourceId('Microsoft.Network/virtualNetworks/subnets', vnetName, subnetName)
      internal: false
    }
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
  dependsOn: [subnet]
}

output environmentName string = environment.name
