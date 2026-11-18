// AIV-P0-018: dev alerts on Aivera's Application Insights, emailed to the team. Log search alerts: a rate needs a
// query, and the cheapest metric alert cannot divide one count by another.
// shortcut: the dead-letter alert comes with the Service Bus queues (AIV-P0-015, #47); production routing and on-call with AIV-P5-010
param tags object
param appInsightsId string
param alertEmail string

resource team 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'ag-aivera-dev'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: 'aivera-dev'
    enabled: true
    emailReceivers: [{ name: 'team', emailAddress: alertEmail, useCommonAlertSchema: true }]
  }
}

var alerts = [
  {
    name: 'alert-aivera-web-5xx-dev'
    description: 'Web 5xx rate above 2% over 5 minutes'
    severity: 2
    // Five-minute evaluation, about $1.50 a month: the ticket's "over 5 min".
    frequency: 'PT5M'
    query: 'requests | summarize total = count(), failed = countif(toint(resultCode) >= 500) | where total > 0 and 100.0 * failed / total > 2'
  }
  {
    name: 'alert-aivera-web-readiness-dev'
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
    location: resourceGroup().location
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
