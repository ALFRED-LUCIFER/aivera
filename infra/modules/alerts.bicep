// AIV-P0-018: dev alerts on Credalent's Application Insights, emailed to the team. Log search alerts: a rate needs a
// query, and the cheapest metric alert cannot divide one count by another.
// shortcut: production routing and on-call with AIV-P5-010
param env string
@description('aivera on dev (its live names), credalent elsewhere: the prefix of every name (main.bicep).')
param brand string
param location string
param tags object
param appInsightsId string
param alertEmail string
@description('Service Bus namespace whose dead-letter queues are watched (AIV-P0-015).')
param serviceBusNamespaceId string

resource team 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'ag-${brand}-${env}'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: '${take(brand, 6)}-${env}'
    enabled: true
    emailReceivers: [{ name: 'team', emailAddress: alertEmail, useCommonAlertSchema: true }]
  }
}

var alerts = [
  {
    name: 'alert-${brand}-web-5xx-${env}'
    description: 'Web 5xx rate above 2% over 5 minutes'
    severity: 2
    // Five-minute evaluation, about $1.50 a month: the ticket's "over 5 min".
    frequency: 'PT5M'
    query: 'requests | summarize total = count(), failed = countif(toint(resultCode) >= 500) | where total > 0 and 100.0 * failed / total > 2'
  }
  {
    name: 'alert-${brand}-web-readiness-${env}'
    description: 'Web readiness probe failing (/api/ready answered 5xx)'
    severity: 1
    // Fifteen-minute evaluation, about $0.50 a month. The app scales to zero, so no replica means no probe and no alert.
    frequency: 'PT15M'
    query: 'requests | where name == "GET /api/ready" and toint(resultCode) >= 500'
  }
]

resource rules 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = [
  for alert in alerts: {
    name: alert.name
    location: location
    tags: tags
    properties: {
      displayName: alert.name
      description: alert.description
      severity: alert.severity
      enabled: true
      scopes: [appInsightsId]
      evaluationFrequency: alert.frequency
      windowSize: alert.frequency
      criteria: {
        allOf: [
          {
            query: alert.query
            timeAggregation: 'Count'
            operator: 'GreaterThan'
            threshold: 0
            failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 }
          }
        ]
      }
      autoMitigate: true
      actions: { actionGroups: [team.id] }
    }
  }
]

// AIV-P0-015: any message in a queue's dead-letter queue, from the platform metric (it also counts TTL expiry, which the
// worker's own `credalent.worker.dead_lettered` counter cannot see). One rule, split per queue; about $0.10 a month each.
// The metric counts messages sitting in the dead-letter queue, so it stays fired until someone drains it. Nothing
// consumes `candidates` yet, so it fires 14 days after the first PersonCreated.v1 (shortcut in apps/worker/src/main.ts).
resource deadLetters 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'alert-${brand}-dead-letters-${env}'
  location: 'global'
  tags: tags
  properties: {
    description: 'Dead-letter count above 0 in a Service Bus queue'
    severity: 2
    enabled: true
    scopes: [serviceBusNamespaceId]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'dead-letters'
          metricNamespace: 'Microsoft.ServiceBus/namespaces'
          metricName: 'DeadletteredMessages'
          dimensions: [{ name: 'EntityName', operator: 'Include', values: ['*'] }]
          timeAggregation: 'Maximum'
          operator: 'GreaterThan'
          threshold: 0
        }
      ]
    }
    autoMitigate: true
    actions: [{ actionGroupId: team.id }]
  }
}
