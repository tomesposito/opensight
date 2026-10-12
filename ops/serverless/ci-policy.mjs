const fail = () => { throw Error('CI_CONFIGURATION_INVALID'); };
export function ciConfig(c) {
  if (c?.version !== 1 || !/^[0-9]{12}$/.test(c.account ?? '') || c.region !== 'us-east-1'
    || !/^[a-z][a-z0-9-]{0,35}$/.test(c.deployment ?? '')
    || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(c.operationsBucket ?? '')
    || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(c.frontendBucket ?? '')
    || !new RegExp(`^arn:aws:kms:${c.region}:${c.account}:key/[a-f0-9-]{36}$`).test(c.kmsKey ?? '')
    || !/^[A-Z0-9]{8,32}$/.test(c.distribution ?? '')
    || !Array.isArray(c.eventMappings) || c.eventMappings.length !== 2 || c.eventMappings.some(v => !/^[a-f0-9-]{36}$/.test(v))
    || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(c.privateRepository ?? '')
    || !/^[1-9][0-9]*$/.test(c.repositoryId ?? '') || !/^[1-9][0-9]*$/.test(c.ownerId ?? '')
    || !/^[a-f0-9]{40}$/.test(c.workflowCommit ?? '')) fail();
  return c;
}
export function ciSubject(config) {
  const c = ciConfig(config);
  return `repository_id:${c.repositoryId}:repository_owner_id:${c.ownerId}:ref:refs/heads/master:event_name:workflow_dispatch:job_workflow_ref:${c.privateRepository}/.github/workflows/controller.yml@${c.workflowCommit}`;
}
export function ciTrust(config) {
  const c = ciConfig(config);
  return { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Federated: `arn:aws:iam::${c.account}:oidc-provider/token.actions.githubusercontent.com` },
    Action: 'sts:AssumeRoleWithWebIdentity', Condition: { StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com', 'token.actions.githubusercontent.com:sub': ciSubject(c) } } }] };
}
export const ciDeny = Object.freeze({ Version: '2012-10-17', Statement: [{ Effect: 'Deny', Action: '*', Resource: '*' }] });
export function ciSessionRevocation(now = Date.now()) {
  return { Version: '2012-10-17', Statement: [{ Effect: 'Deny', Action: '*', Resource: '*', Condition: { DateLessThan: { 'aws:TokenIssueTime': new Date(now).toISOString() } } }] };
}
export function ciClosedTrust(config) {
  const trust = ciTrust(config);
  return { Version: trust.Version, Statement: [{ Effect: 'Deny', Principal: trust.Statement[0].Principal, Action: 'sts:AssumeRoleWithWebIdentity' }] };
}
export function ciPolicy(config, kind) {
  const c = ciConfig(config); if (!['read', 'deploy'].includes(kind)) fail();
  const lambda = `arn:aws:lambda:${c.region}:${c.account}`, functions = ['request', 'work', 'recovery', 'ingress'].map(n => `${lambda}:function:${c.deployment}-${n}`);
  const bucket = `arn:aws:s3:::${c.operationsBucket}`, frontend = `arn:aws:s3:::${c.frontendBucket}`;
  const allow = (Action, Resource, Condition) => ({ Effect: 'Allow', Action, Resource, ...(Condition ? { Condition } : {}) });
  return { Version: '2012-10-17', Statement: [
    { Effect: 'Deny', Action: ['sts:AssumeRole', 'secretsmanager:GetSecretValue', 'ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath', 'rds-data:*'], Resource: '*' },
    allow(['s3:GetObject', 's3:GetObjectVersion'], [`${bucket}/ci/config/*`, `${bucket}/ci/approvals/*`, `${bucket}/ci/releases/*`, `${bucket}/ci/operations/*`]),
    allow(['kms:Decrypt', ...(kind === 'deploy' ? ['kms:GenerateDataKey'] : [])], c.kmsKey,
      { StringEquals: { 'kms:ViaService': `s3.${c.region}.amazonaws.com`, 'kms:EncryptionContext:aws:s3:arn': bucket } }),
    allow(['lambda:GetFunction', 'lambda:GetFunctionConfiguration', 'lambda:GetFunctionConcurrency'], functions),
    allow('lambda:GetAlias', functions[0]),
    allow('lambda:GetEventSourceMapping', c.eventMappings.map(id => `${lambda}:event-source-mapping:${id}`)),
    ...(kind === 'deploy' ? [
      allow(['s3:PutObject', 's3:DeleteObject'], [`${bucket}/ci/operations/*`, `${bucket}/ci/releases/*`]),
      allow(['s3:GetObject', 's3:GetObjectVersion', 's3:PutObject'], `${frontend}/frontend/*`),
      allow('s3:ListBucket', frontend),
      allow(['lambda:UpdateFunctionCode', 'lambda:PublishVersion', 'lambda:PutFunctionConcurrency'], functions),
      allow('lambda:UpdateAlias', functions[0]),
      allow('lambda:UpdateEventSourceMapping', c.eventMappings.map(id => `${lambda}:event-source-mapping:${id}`)),
      allow('ecr:GetAuthorizationToken', '*'),
      allow(['ecr:BatchCheckLayerAvailability', 'ecr:GetDownloadUrlForLayer', 'ecr:BatchGetImage', 'ecr:InitiateLayerUpload', 'ecr:UploadLayerPart', 'ecr:CompleteLayerUpload', 'ecr:PutImage', 'ecr:DescribeImages'], `arn:aws:ecr:${c.region}:${c.account}:repository/${c.deployment}`),
      allow('cloudfront:CreateInvalidation', `arn:aws:cloudfront::${c.account}:distribution/${c.distribution}`),
      allow(['scheduler:CreateSchedule', 'scheduler:GetSchedule', 'scheduler:DeleteSchedule'], `arn:aws:scheduler:${c.region}:${c.account}:schedule/${c.deployment}-ci-release/release-*`),
      allow('iam:PassRole', `arn:aws:iam::${c.account}:role/${c.deployment}-ci-watchdog-invoke`, { StringEquals: { 'iam:PassedToService': 'scheduler.amazonaws.com' } }),
    ] : []),
  ] };
}
