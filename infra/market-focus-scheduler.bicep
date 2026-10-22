targetScope = 'resourceGroup'

@description('Logic App (Consumption) name')
param logicAppName string = 'logic-market-focus-scheduler'

@description('Public site base URL (no trailing slash)')
param siteBaseUrl string = 'https://vestential.com'

@secure()
@description('SYNC_TOKEN shared with the app (same value as App Service setting)')
param syncToken string

@allowed(['refresh', 'dry'])
@description('refresh = production run; dry = preview only (no DB write / no email / no social)')
param runKind string = 'refresh'

@description('Email receiver for Azure Monitor run-failure alerts')
param alertEmail string = 'yuzora_roy@hotmail.com'

var definition = loadJsonContent('./market-focus-workflow.definition.json')

resource logicApp 'Microsoft.Logic/workflows@2019-05-01' = {
  name: logicAppName
  location: resourceGroup().location
  properties: {
    state: 'Enabled'
    definition: definition
    parameters: {
      siteBaseUrl: {
        value: siteBaseUrl
      }
      syncToken: {
        value: syncToken
      }
      runKind: {
        value: runKind
      }
    }
  }
}

// Azure Monitor 安全網：Logic App 本身跑失敗（連線、401、輪詢錯誤）時，
// 不依賴應用程式（可能也掛了）也能寄信。
resource actionGroup 'Microsoft.Insights/actionGroups@2022-06-01' = {
  name: 'ag-market-focus-scheduler'
  location: 'global'
  properties: {
    groupShortName: 'mfsched'
    enabled: true
    emailReceivers: [
      {
        name: 'ops'
        emailAddress: alertEmail
        useCommonAlertSchema: true
      }
    ]
  }
}

resource failedRunAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'alert-market-focus-scheduler-failed'
  location: 'global'
  properties: {
    description: 'Market focus Logic App run failed (trigger/poll/app error)'
    severity: 2
    enabled: true
    scopes: [
      logicApp.id
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'RunsFailed'
          metricName: 'RunsFailed'
          metricNamespace: 'Microsoft.Logic/workflows'
          operator: 'GreaterThan'
          threshold: 0
          timeAggregation: 'Total'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: [
      {
        actionGroupId: actionGroup.id
      }
    ]
  }
}

output logicAppId string = logicApp.id
output logicAppName string = logicApp.name
