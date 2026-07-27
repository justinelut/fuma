import type { HostedMigration } from '../db/migrationPolicy'
import { publishingMigration } from '../db/migrations/000021_publishing'
import { freeHostsMigration } from '../db/migrations/000022_free_hosts'
import { edgeDeliveryMigration } from '../db/migrations/000023_edge_delivery'
import { meteringMigration } from '../db/migrations/000024_metering'
import { paystackPrimitivesMigration } from '../db/migrations/000025_paystack_primitives'
import { entitlementsMigration } from '../db/migrations/000026_entitlements'
import { checkoutMigration } from '../db/migrations/000027_checkout'
import { billingReconciliationMigration } from '../db/migrations/000028_billing_reconciliation'
import { quotaEnforcementMigration } from '../db/migrations/000029_quota_enforcement'
import { customerPaymentsMigration } from '../db/migrations/000030_customer_payments'
import { domainsMigration } from '../db/migrations/000031_domains'
import { cloudflareSaasMigration } from '../db/migrations/000032_cloudflare_saas'
import { registrarMigration } from '../db/migrations/000033_registrar'
import { domainOperationsMigration } from '../db/migrations/000034_domain_operations'

export const COMMERCIAL_EDGE_MIGRATIONS:readonly HostedMigration[]=Object.freeze([publishingMigration,freeHostsMigration,edgeDeliveryMigration,meteringMigration,paystackPrimitivesMigration,entitlementsMigration,checkoutMigration,billingReconciliationMigration,quotaEnforcementMigration,customerPaymentsMigration,domainsMigration,cloudflareSaasMigration,registrarMigration,domainOperationsMigration])
export const COMMERCIAL_EDGE_MIGRATION_CHECKSUMS=Object.freeze({
'000021_publishing':'8a79cf2f5ef6027f17be8b66680ff7719179272cfd0d34ad98dbfba419932861','000022_free_hosts':'9068ad709cb18818b61b7eb1aa492dd2fb3b09f093635a48107aa72ec67d1d06','000023_edge_delivery':'f09edd657a02b0118bbf3c169a97c591583c4a89b87467aa5df090c83f5ba9c0','000024_metering':'a319bcad72357b054a9570a9830a8bbeab2bcecb9cb97ce39051ba22bf269c97','000025_paystack_primitives':'6410eb7f53ae944ff5e36ec84a452db6a45b8ba13e052a7be7eb06da1f7fc4ab','000026_entitlements':'1e7f2f2db6791fbf7db3db4f29563d5487ba53e5be39e901e32de0e241337f70','000027_checkout':'9c9e855479939acce616809824bc2d1e35d68e49ff2258189a1ee6a0f7d09184','000028_billing_reconciliation':'c340ca477439c610bf06c0e632b7611508ba5de3faa5fe7a612729b958e6c486','000029_quota_enforcement':'7a58c65ed47869da9f0b93efbbc70fbc90e5831763d9a409645f6d407f27acc2','000030_customer_payments':'7f7960686ea38d6f5505a5a5ec29db7e4adb28d185d625487b91ffd9de91869a','000031_domains':'2bc675da68009a091b829266582be045736cec2bad6c3ac39dc69a372c17d21b','000032_cloudflare_saas':'f7ba13b5f3401c73adce06dd89232424b0fc0031f2c4730f81f5c51f5b6ab24b','000033_registrar':'7d50061ef8861259c7e21e0e1eec6db8f3fc237ed5b5c2e7a8801b15b8b4867c','000034_domain_operations':'be3814c6508761e5930ab61c1f87681bd5e4f7a1f6b7cf159fbb132c75df5bbf'})
