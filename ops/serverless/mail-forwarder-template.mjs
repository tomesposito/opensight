import { readFileSync } from 'node:fs';
const ref = Ref => ({ Ref }), sub = value => ({ 'Fn::Sub': value }), get = (name, attribute) => ({ 'Fn::GetAtt': [name, attribute] });
export function forwardingTemplate() {
  const ruleArn = sub('arn:${AWS::Partition}:ses:${AWS::Region}:${AWS::AccountId}:receipt-rule-set/${RuleSet}:receipt-rule/contact');
  const aliases = [sub('support@${Domain}'), sub('privacy@${Domain}')];
  return { AWSTemplateFormatVersion: '2010-09-09', Description: 'Bounded sandbox contact forwarding; private parameters only',
    Parameters: {
      Deployment: { Type: 'String', AllowedPattern: '[a-z][a-z0-9-]{0,35}' },
      Domain: { Type: 'String', AllowedPattern: '[a-z0-9][a-z0-9.-]+[a-z0-9]' },
      Destination: { Type: 'String', NoEcho: true, AllowedPattern: '[^ @\\r\\n]+@[^ @\\r\\n]+\\.[^ @\\r\\n]+' },
      ZoneId: { Type: 'String', AllowedPattern: 'Z[A-Z0-9]+' },
      PublishMx: { Type: 'String', Default: 'false', AllowedValues: ['true', 'false'] },
    }, Conditions: { PublishMx: { 'Fn::Equals': [ref('PublishMx'), 'true'] } },
    Resources: {
      MailBucket: { Type: 'AWS::S3::Bucket', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain', Properties: {
        BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
        OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
        PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
        LifecycleConfiguration: { Rules: [{ Id: 'raw-retention', Status: 'Enabled', Prefix: 'raw/', ExpirationInDays: 7 },
          { Id: 'receipt-retention', Status: 'Enabled', Prefix: 'receipts/', ExpirationInDays: 30 }] },
      } },
      MailBucketPolicy: { Type: 'AWS::S3::BucketPolicy', Properties: { Bucket: ref('MailBucket'), PolicyDocument: { Version: '2012-10-17', Statement: [
        { Effect: 'Deny', Principal: '*', Action: 's3:*', Resource: [get('MailBucket','Arn'), sub('${MailBucket.Arn}/*')], Condition: { Bool: { 'aws:SecureTransport': 'false' } } },
        { Effect: 'Allow', Principal: { Service: 'ses.amazonaws.com' }, Action: 's3:PutObject', Resource: sub('${MailBucket.Arn}/raw/*'),
          Condition: { StringEquals: { 'AWS:SourceAccount': ref('AWS::AccountId'), 'AWS:SourceArn': ruleArn } } },
      ] } } },
      Failures: { Type: 'AWS::SQS::Queue', DeletionPolicy: 'Retain', Properties: { SqsManagedSseEnabled: true, MessageRetentionPeriod: 604800 } },
      Role: { Type: 'AWS::IAM::Role', Properties: {
        AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] },
        Policies: [{ PolicyName: 'bounded-forwarding', PolicyDocument: { Version: '2012-10-17', Statement: [
          { Effect: 'Allow', Action: 's3:GetObject', Resource: [sub('${MailBucket.Arn}/raw/*'), sub('${MailBucket.Arn}/receipts/*')] },
          { Effect: 'Allow', Action: 's3:PutObject', Resource: sub('${MailBucket.Arn}/receipts/*') },
          { Effect: 'Allow', Action: ['ses:SendEmail', 'ses:SendRawEmail'], Resource: [sub('arn:${AWS::Partition}:ses:${AWS::Region}:${AWS::AccountId}:identity/${Domain}'), sub('arn:${AWS::Partition}:ses:${AWS::Region}:${AWS::AccountId}:identity/${Destination}')],
            Condition: { StringEquals: { 'ses:FromAddress': sub('support@${Domain}') }, 'ForAllValues:StringEquals': { 'ses:Recipients': [ref('Destination')] }, Null: { 'ses:Recipients': 'false' } } },
          { Effect: 'Allow', Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Resource: sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/${Deployment}-contact-forwarder:*') },
          { Effect: 'Allow', Action: 'sqs:SendMessage', Resource: get('Failures','Arn') },
        ] } }],
      } },
      Logs: { Type: 'AWS::Logs::LogGroup', Properties: { LogGroupName: sub('/aws/lambda/${Deployment}-contact-forwarder'), RetentionInDays: 7 } },
      Function: { Type: 'AWS::Lambda::Function', DependsOn: ['Logs'], Properties: {
        FunctionName: sub('${Deployment}-contact-forwarder'), Runtime: 'nodejs24.x', Architectures: ['arm64'], Handler: 'index.handler',
        Role: get('Role','Arn'), Timeout: 60, MemorySize: 512, ReservedConcurrentExecutions: 1,
        Environment: { Variables: { MAIL_BUCKET: ref('MailBucket'), MAIL_DESTINATION: ref('Destination'), MAIL_SENDER: sub('support@${Domain}'), MAIL_SUPPORT: aliases[0], MAIL_PRIVACY: aliases[1] } },
        Code: { ZipFile: readFileSync(new URL('./mail-forwarder.cjs', import.meta.url), 'utf8') },
      } },
      Retry: { Type: 'AWS::Lambda::EventInvokeConfig', Properties: { FunctionName: ref('Function'), Qualifier: '$LATEST', MaximumEventAgeInSeconds: 3600, MaximumRetryAttempts: 0, DestinationConfig: { OnFailure: { Destination: get('Failures','Arn') } } } },
      RuleSet: { Type: 'AWS::SES::ReceiptRuleSet', Properties: { RuleSetName: sub('${Deployment}-contacts') } },
      Permission: { Type: 'AWS::Lambda::Permission', Properties: { Action: 'lambda:InvokeFunction', FunctionName: ref('Function'), Principal: 'ses.amazonaws.com', SourceAccount: ref('AWS::AccountId'), SourceArn: ruleArn } },
      Rule: { Type: 'AWS::SES::ReceiptRule', DependsOn: ['MailBucketPolicy', 'Permission', 'Retry'], Properties: { RuleSetName: ref('RuleSet'), Rule: {
        Name: 'contact', Enabled: true, ScanEnabled: true, TlsPolicy: 'Optional', Recipients: aliases,
        Actions: [{ S3Action: { BucketName: ref('MailBucket'), ObjectKeyPrefix: 'raw/' } }, { LambdaAction: { FunctionArn: get('Function','Arn'), InvocationType: 'Event' } }, { StopAction: { Scope: 'RuleSet' } }],
      } } },
      Mx: { Type: 'AWS::Route53::RecordSet', Condition: 'PublishMx', DependsOn: ['Rule'], Properties: { HostedZoneId: ref('ZoneId'), Name: ref('Domain'), Type: 'MX', TTL: '300', ResourceRecords: [sub('10 inbound-smtp.${AWS::Region}.amazonaws.com')] } },
    }, Outputs: { Bucket: { Value: ref('MailBucket') }, Function: { Value: ref('Function') }, RuleSet: { Value: ref('RuleSet') }, Failures: { Value: ref('Failures') } },
  };
}
