// AIV-P1-096: the pilot environment, UAE North, real candidate data. Names and sizes only: the per-run and tenant values
// are read from the owner's shell when the CLI compiles this file, so none is committed (docs/runbooks/pilot-environment.md).
// infra/scripts/pilot-params.test.mjs guards the region, scanning and synthetic settings below.
using 'main.bicep'

param env = 'pilot'
// Every regional resource; the AI resource and ACS data location are pinned to UAE North in their modules.
param location = 'uaenorth'
// Defender scans every upload: real candidate files (apps/web refuses to start with it off where APP_ENV is pilot).
param malwareScanning = true
param vnetPrefix = '10.60.0.0/16'
param postgresSku = 'Standard_B2s'
param backupRetentionDays = 14

param imageTag = readEnvironmentVariable('IMAGE_TAG')
param alertEmail = readEnvironmentVariable('ALERT_EMAIL')
param entraTenantSubdomain = readEnvironmentVariable('ENTRA_TENANT_SUBDOMAIN')
param entraTenantId = readEnvironmentVariable('ENTRA_TENANT_ID')
param entraRecruiterClientId = readEnvironmentVariable('ENTRA_RECRUITER_CLIENT_ID')
// main.bicep's GitHub App defaults are dev's (credalent-dev-evidence-reader-2); the pilot has no such app.
param githubAppId = ''
param githubAppInstallationId = ''
