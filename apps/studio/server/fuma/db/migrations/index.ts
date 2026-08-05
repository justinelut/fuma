import { HOSTED_MIGRATION_CHECKSUM_SENTINEL } from '../migrationPolicy'
import { transitionBookkeepingMigration } from './000001_transition_bookkeeping'
import { durableJobsMigration } from './000002_durable_jobs'
import { staffIdentityMigration } from './000003_staff_identity'
import { organizationsMigration } from './000004_organizations'
import { workspacesMigration } from './000005_workspaces'
import { sitesMigration } from './000006_sites'
import { auditHistoryMigration } from './000007_audit_history'
import { transferSagaMigration } from './000008_transfer_saga'
import { tenantKeysMigration } from './000009_tenant_keys'
import { editorResourcesMigration } from './000010_editor_resources'
import { editorDraftSequencesMigration } from './000012_editor_draft_sequences'
import { releasesMigration } from './000011_releases'
import { publicationCollaborationMigration } from './000013_publication_collaboration'
import { publicationContentMigration } from './000014_publication_content'
import { publicationWorkflowMigration } from './000015_publication_workflows'
import { publicationAudienceMigration } from './000016_publication_audience'
import { publicationAnalyticsMigration } from './000017_publication_analytics'
import { publicationNewslettersMigration } from './000018_publication_newsletters'
import { publicationCampaignsMigration } from './000019_publication_campaigns'
import { publicationDeliverabilityMigration } from './000020_publication_deliverability'
import { publishingMigration } from './000021_publishing'
import { freeHostsMigration } from './000022_free_hosts'
import { edgeDeliveryMigration } from './000023_edge_delivery'
import { meteringMigration } from './000024_metering'
import { paystackPrimitivesMigration } from './000025_paystack_primitives'
import { entitlementsMigration } from './000026_entitlements'
import { checkoutMigration } from './000027_checkout'
import { billingReconciliationMigration } from './000028_billing_reconciliation'
import { quotaEnforcementMigration } from './000029_quota_enforcement'
import { customerPaymentsMigration } from './000030_customer_payments'
import { domainsMigration } from './000031_domains'
import { cloudflareSaasMigration } from './000032_cloudflare_saas'
import { registrarMigration } from './000033_registrar'
import { domainOperationsMigration } from './000034_domain_operations'
import { aiGovernanceMigration } from './000035_ai_governance'
import { pluginsMarketplaceMigration } from './000036_plugins_marketplace'
import { operationsExpertsTransferMigration } from './000037_operations_experts_transfer'
import { structuredImportsMigration } from './000038_structured_imports'
import { launchEvidencePrivacyMigration } from './000039_launch_evidence_privacy'
import { publicationUniversalContentMigration } from './000040_publication_universal_content'
import { publicationRevisionsMigration } from './000041_publication_revisions'
import { memberIdentityRealmMigration } from './000042_member_identity_realm'
import { freeHostAuthorityMigration } from './000043_free_host_authority'
import { publicationLifecycleMetadataMigration } from './000044_publication_lifecycle_metadata'
import { paystackReconciliationMigration } from './000045_paystack_reconciliation'
import { publicationEditorialWorkflowMigration } from './000046_editorial_workflow'
import { memberAccountsAccessMigration } from './000047_member_accounts_access'
import { publicationSchedulingAccessMigration } from './000048_publication_scheduling_access'
import { emailSettingsVersionsMigration } from './000049_email_settings_versions'
import { dynamicPublicationTemplatesMigration } from './000050_dynamic_publication_templates'
import { publicationPrivacyAnalyticsMigration } from './000051_publication_privacy_analytics'
import { publicationNewsletterComposerMigration } from './000052_publication_newsletter_composer'
import { publicationCampaignDeliveryControlMigration } from './000053_publication_campaign_delivery_control'
import { publicationDeliverabilityControlMigration } from './000054_publication_deliverability_control'
import { meteringReconciliationControlMigration } from './000055_metering_reconciliation_control'
import { publicTemplateReleasesMigration } from './000056_public_template_releases'
import { entitlementEvidenceMigration } from './000057_entitlement_evidence'
import { platformCheckoutAuthorityMigration } from './000058_platform_checkout_authority'
import { platformBillingReconciliationMigration } from './000059_platform_billing_reconciliation'
import { quotaSelfServiceMigration } from './000060_quota_self_service'
import { customerMerchantPaymentsV2Migration } from './000061_customer_merchant_payments_v2'
import { domainContractAuthorityV2Migration } from './000062_domain_contract_authority_v2'
import { aiCatalogAuthorityMigration } from './000063_ai_catalog_authority'
import { cloudflareHostnameAuthorityV2Migration } from './000064_cloudflare_hostname_authority_v2'
import { registrarLifecycleAuthorityMigration } from './000065_registrar_lifecycle_authority'
import { aiCreditsAuthorityMigration } from './000066_ai_credits_authority'
import { domainOperationsAuthorityMigration } from './000067_domain_operations_authority'
import { siteAiScopeAuthorityMigration } from './000068_site_ai_scope_authority'
import { mcpConnectorAuthorityMigration } from './000069_mcp_connector_authority'
import { artifactInstallationAuthorityMigration } from './000070_artifact_installation_authority'
import { artifactReviewMarketplaceMigration } from './000071_artifact_review_marketplace'
import { siteRuntimeApplicationMigration } from './000072_site_runtime_application'
import { customerPaymentPluginMigration } from './000073_customer_payment_plugin'
import { aiPaymentSetupMigration } from './000074_ai_payment_setup'
import { componentCatalogAuthorityMigration } from './000075_component_catalog_authority'
import { supportOperationsAuthorityMigration } from './000076_support_operations_authority'
import { publicHandoffAuthorityMigration } from './000077_public_handoff_authority'
import { nextSourcePortabilityAuthorityMigration } from './000078_next_source_portability_authority'

export const hostedMigrations = Object.freeze([
  transitionBookkeepingMigration,
  durableJobsMigration,
  staffIdentityMigration,
  organizationsMigration,
  workspacesMigration,
  sitesMigration,
  auditHistoryMigration,
  transferSagaMigration,
  tenantKeysMigration,
  editorResourcesMigration,
  releasesMigration,
  editorDraftSequencesMigration,
  publicationCollaborationMigration,
  publicationContentMigration,
  publicationWorkflowMigration,
  publicationAudienceMigration,
  publicationAnalyticsMigration,
  publicationNewslettersMigration,
  publicationCampaignsMigration,
  publicationDeliverabilityMigration,
  publishingMigration,
  freeHostsMigration,
  edgeDeliveryMigration,
  meteringMigration,
  paystackPrimitivesMigration,
  entitlementsMigration,
  checkoutMigration,
  billingReconciliationMigration,
  quotaEnforcementMigration,
  customerPaymentsMigration,
  domainsMigration,
  cloudflareSaasMigration,
  registrarMigration,
  domainOperationsMigration,
  aiGovernanceMigration,
  pluginsMarketplaceMigration,
  operationsExpertsTransferMigration,
  structuredImportsMigration,
  launchEvidencePrivacyMigration,
  publicationUniversalContentMigration,
  publicationRevisionsMigration,
  memberIdentityRealmMigration,
  freeHostAuthorityMigration,
  publicationLifecycleMetadataMigration,
  paystackReconciliationMigration,
  publicationEditorialWorkflowMigration,
  memberAccountsAccessMigration,
  publicationSchedulingAccessMigration,
  emailSettingsVersionsMigration,
  dynamicPublicationTemplatesMigration,
  publicationPrivacyAnalyticsMigration,
  publicationNewsletterComposerMigration,
  publicationCampaignDeliveryControlMigration,
  publicationDeliverabilityControlMigration,
  meteringReconciliationControlMigration,
  publicTemplateReleasesMigration,
  entitlementEvidenceMigration,
  platformCheckoutAuthorityMigration,
  platformBillingReconciliationMigration,
  quotaSelfServiceMigration,
  customerMerchantPaymentsV2Migration,
  domainContractAuthorityV2Migration,
  aiCatalogAuthorityMigration,
  cloudflareHostnameAuthorityV2Migration,
  registrarLifecycleAuthorityMigration,
  aiCreditsAuthorityMigration,
  domainOperationsAuthorityMigration,
  siteAiScopeAuthorityMigration,
  mcpConnectorAuthorityMigration,
  artifactInstallationAuthorityMigration,
  artifactReviewMarketplaceMigration,
  siteRuntimeApplicationMigration,
  customerPaymentPluginMigration,
  aiPaymentSetupMigration,
  componentCatalogAuthorityMigration,
  supportOperationsAuthorityMigration,
  publicHandoffAuthorityMigration,
  nextSourcePortabilityAuthorityMigration,
])

export const HOSTED_MIGRATION_CHECKSUMS: Readonly<Record<string, string>> = Object.freeze({
  '000001_transition_bookkeeping': 'faa1fbdeb664da6ee93384e1c04ca62e166dab5a2f84cf21acca4c528bb49f5a',
  '000002_durable_jobs': '2e0ea46ac22411481a571c45eef336e7c319a39d4c71c28dc0e746702598f093',
  '000003_staff_identity': '8a80e4cd07d2a49a254d44769f466ffc014924a5377f6dd655155c11ae695221',
  '000004_organizations': '037410d0991d671c49e74acf5e04d9e98c496c6e38cff613b30db38a1c2c48b4',
  '000005_workspaces': '0d24040f7454107b1891a9fe91b44d33f08515c272b3b3a0e57ce2fa840d4ad2',
  '000006_sites': 'b767a08415ba95afb34acd0c3ff8728c027eb6ad12f1598490a05d32d98d332f',
  // Finalized from hostedMigrationChecksum(auditHistoryMigration.sql).
  '000007_audit_history': '0823e4e3592bb5b6347d85e04cab85367c313a9753aea4fb7bc0e7753bc1d07e',
  // Finalized from hostedMigrationChecksum(transferSagaMigration.sql) after 000007.
  '000008_transfer_saga': '04ab1226ce0010a06183847d6feec927ab4d583fcafdf69321d70bab1686e852',
  // Finalized from hostedMigrationChecksum(tenantKeysMigration.sql) after 000007/000008.
  '000009_tenant_keys': '43e27fb6a3d46bb76e9e47be448fa58a6bada9aad86e7a4451f49daec566964a',
  // Finalized from hostedMigrationChecksum(editorResourcesMigration.sql).
  '000010_editor_resources': '71f39c0c8fbbd4fdd1aa6686ad098a5fb53ea01b562ee0548e4458d8ba1027e1',
  // Finalized from hostedMigrationChecksum(releasesMigration.sql).
  '000011_releases': '1314bb5e96680363917b95f3ed3c46bfd9364519043b7698726a1758959c793b',
  // Finalized from hostedMigrationChecksum(editorDraftSequencesMigration.sql).
  '000012_editor_draft_sequences': '92048e16ad1a019569731cbcfcfbb39dbfd6bd439b62ea448af7107a28ed4070',
  '000013_publication_collaboration': '451a3c44f01e73a94a2b7ea7eadeecc532be1dbcbaa7a868d72fe52c8a13d47f',
  '000014_publication_content': '125b4074ff43a02394eb18725552157a1ede129135fc2c8ba7b5ef09ad27f1d1',
  '000015_publication_workflows': '8db721e014ab3e8879d6352f7d45f8e72a5ddc4714f18a8bde5dbca034cbfe0f',
  '000016_publication_audience': '2ea6e7d6198d8af94637d090c9f24646c3e38e4c7093d0c60676f5abf3e6a0dc',
  '000017_publication_analytics': 'ba4016348e82f88a5551fe1939a230c2c1a0a0839be7333a310220ec5324f373',
  '000018_publication_newsletters': '7f38648cdeef768e3aedda14067cdf3f7c863cafa49a497845d24a326dd44847',
  '000019_publication_campaigns': '4a189a7a6d65ae9a9a5597a3749a5767e69b79fce8aea72498ab680f18617328',
  '000020_publication_deliverability': '3ebe7a042aee394188179d4f4550a7a4e5055cd76cda6badb0b7332fddb4cb75',
  '000021_publishing': '8a79cf2f5ef6027f17be8b66680ff7719179272cfd0d34ad98dbfba419932861',
  '000022_free_hosts': '9068ad709cb18818b61b7eb1aa492dd2fb3b09f093635a48107aa72ec67d1d06',
  '000023_edge_delivery': 'f09edd657a02b0118bbf3c169a97c591583c4a89b87467aa5df090c83f5ba9c0',
  '000024_metering': 'a319bcad72357b054a9570a9830a8bbeab2bcecb9cb97ce39051ba22bf269c97',
  '000025_paystack_primitives': '6410eb7f53ae944ff5e36ec84a452db6a45b8ba13e052a7be7eb06da1f7fc4ab',
  '000026_entitlements': '1e7f2f2db6791fbf7db3db4f29563d5487ba53e5be39e901e32de0e241337f70',
  '000027_checkout': '9c9e855479939acce616809824bc2d1e35d68e49ff2258189a1ee6a0f7d09184',
  '000028_billing_reconciliation': 'c340ca477439c610bf06c0e632b7611508ba5de3faa5fe7a612729b958e6c486',
  '000029_quota_enforcement': '7a58c65ed47869da9f0b93efbbc70fbc90e5831763d9a409645f6d407f27acc2',
  '000030_customer_payments': '7f7960686ea38d6f5505a5a5ec29db7e4adb28d185d625487b91ffd9de91869a',
  '000031_domains': '2bc675da68009a091b829266582be045736cec2bad6c3ac39dc69a372c17d21b',
  '000032_cloudflare_saas': 'f7ba13b5f3401c73adce06dd89232424b0fc0031f2c4730f81f5c51f5b6ab24b',
  '000033_registrar': '7d50061ef8861259c7e21e0e1eec6db8f3fc237ed5b5c2e7a8801b15b8b4867c',
  '000034_domain_operations': 'be3814c6508761e5930ab61c1f87681bd5e4f7a1f6b7cf159fbb132c75df5bbf',
  '000035_ai_governance': '072d4b34259dcec3e7a55bff635154d6ed25bdfbf424bae676b1be021b74bba8',
  '000036_plugins_marketplace': '1d0b2bb99324e5bf80eaa0c2291f9420c8ca27ff24163e94e91bd2cd5802fddf',
  '000037_operations_experts_transfer': 'b58100c5e0235532f227dd466a2641c8d8d6faef58de19b4e75c2ecbe9f08e3d',
  '000038_structured_imports': 'c50935789450eb038997820a76414ba699c86990cd0db1cb22c64efaa8808611',
  '000039_launch_evidence_privacy': '4b6d1505840fa1a30f4895ba75b84ab29ec6ec4b3e0f87796dba19ff4ec855c2',
  '000040_publication_universal_content': '002244022f0c0a799cf0a2e8b3601736225ef97fd03cef6c3c6dc2112161d233',
  '000041_publication_revisions': '7ea67a5fd66af9c8be2515a1b303baf2831363fe9b1a23437d97c47cb47966cc',
  '000042_member_identity_realm': '638536b3172e3242741e8d587a0ef35f0d86012629f29bf89584913fa12208e0',
  '000043_free_host_authority': 'd41fda99a82a0e260d386c3feababfda65cb67b4972f88a24c33f3e555bb375b',
  '000044_publication_lifecycle_metadata': 'fa352e5abdc480422c3d514b7d48b4105f361cbda05204a699d7e7665e5355fe',
  '000045_paystack_reconciliation': 'eb45811cd1e00907c36ac4a3ee6a113731712220b56c8bb406ff90a021f817d8',
  '000046_editorial_workflow': '11a2c6f4fb4ad620a92d5e0473bc623c5e2e8460e177a5e9270dfc52c21c27d7',
  '000047_member_accounts_access': 'f6ec6be3ce04e68aa1c9d26c29f080d324f9814b0001ae0aef09f814f0c16a2d',
  '000048_publication_scheduling_access': 'a885f580e0d87224c149dc195dd746e858ea6f95d5fc7c10b2636e25d13f4e64',
  '000049_email_settings_versions': 'e3280afa67913e9132a1e4ddabff1f77db3ad95c63223cdabc65db4abe7ad8b7',
  '000050_dynamic_publication_templates': '3e3b3c2fe969eddca1063f62a63ada426949623a8110ca23caa5483b1ee1c34b',
  '000051_publication_privacy_analytics': 'a6deae4ed574da8ec0065f92883bcf2a77738d011d2a93b15a8e41a21fbb208e',
  '000052_publication_newsletter_composer': '8df028670e3e18fc6bc165805bb0793e1dc2ce13253fc729fb666e3fad15cd61',
  '000053_publication_campaign_delivery_control': '458f4a35eef21e8b4b43ac71d28cceb43271ab43b0669f5b5ebd15cfa76002b6',
  '000054_publication_deliverability_control': 'b08f316eb43349a1b3cc281a12fdf1eba90262d49bd504b959b6954e3a548c1a',
  '000055_metering_reconciliation_control': 'e5462ac7ea62f35fce1925fffc51894a2964ec61a5cec08d33c7f35d372f18b7',
  '000056_public_template_releases': 'ca89eeadaf781bd806217a5b74d58849c851372a8c838806d4953641c259789e',
  '000057_entitlement_evidence': '0aa1ce2983b7e4781c03f2d8f437be1779a75f3cd5d31f7b0e24197a87c6f016',
  '000058_platform_checkout_authority': '39b444f6ee4783354dda373f0f3e1315b77c77febdfb782b43984d8e63219e8b',
  '000059_platform_billing_reconciliation': '2e66877da6c258cb060cd0d525c70274509d8134248d7bb6c686fbb505e3d4a3',
  '000060_quota_self_service': 'af8a6667a5a2bc2275e2c48f07679a8547193c0a1d9bacf5f1424be523c429e7',
  '000061_customer_merchant_payments_v2': '1c481f0670054f4510e54db03f24da3d9648778d74d289245c1fd9a3f2e401e7',
  '000062_domain_contract_authority_v2': '275de598666587dbf9ce82d10da38e19709859b2e50dcf0f4c9a5fda56d380c7',
  '000063_ai_catalog_authority': '218a40b70d8774a4774bc9b0b5c9b5ffe002b8b793ba87c067e88f7a92682ec8',
  '000064_cloudflare_hostname_authority_v2': '7c7618b311d6034f9e30da6c45627de1420e8abfcb76108f408a4bafbf577271',
  '000065_registrar_lifecycle_authority': 'dc0c88c44440871af1d02bd4d0ee0143dec54219b55bfef380643e0144c2b340',
  '000066_ai_credits_authority': '9de088d429ae82927f92145d191851f99dd98a92f5c852a0a64f0e6a43796517',
  '000067_domain_operations_authority': '6cfe60d80f884bcb6c9887c118296894c6ea514a29acac4c0c022dc456f1556f',
  '000068_site_ai_scope_authority': '0c0368622abc603c03cd46e2c37107c2efc61c38f1bb3335539efcffa1e77bd5',
  '000069_mcp_connector_authority': '4b92c690302ae47184663870b86a7d4179b89eeac097307b9e5589b82cea819d',
  '000070_artifact_installation_authority': '96c9471345d70bc6cb6636f9f1581859ddc4acb03efe52c3f273da8ed1f2afc8',
  '000071_artifact_review_marketplace': '168275b6e4f9861ca4b931bec3e8118c5ac23506219d2f632912a4acff905f41',
  '000072_site_runtime_application': '48b68eb8fa97e6f47a9ef97c510adedd975e88ef39425d9b26e3b24db74722da',
  '000073_customer_payment_plugin': '393a785bfed74ef9e6f3545d8fb65ec7a76c6351573874c9d09650b825d6f9a6',
  '000074_ai_payment_setup': '29cc495c97c6bb78f915a9ab5116c2ca997294d4f483c6af8f9433f07b483615',
  '000075_component_catalog_authority': '760f409e118eaffcd72323ffd2f70aaf008bbde3e732e3372afcaf8e64657f61',
  '000076_support_operations_authority': 'bafa690ed6e28b161036b235d55c098534e61af929c31824f35a6541ae5ce60e',
  '000077_public_handoff_authority': 'fb257b84c2e44b65212ef5227845c50524887248fb10732a6ec46a4b7dd53015',
  '000078_next_source_portability_authority': HOSTED_MIGRATION_CHECKSUM_SENTINEL,
})

const firstUnappliedMigration = hostedMigrations.findIndex(({ id }) => (
  HOSTED_MIGRATION_CHECKSUMS[id] === HOSTED_MIGRATION_CHECKSUM_SENTINEL
))

/** Checksum-finalized prefix that the hosted runner may plan and apply. */
export const runnableHostedMigrations = Object.freeze(hostedMigrations.slice(
  0,
  firstUnappliedMigration === -1 ? hostedMigrations.length : firstUnappliedMigration,
))
