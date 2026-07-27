export const pricingEnvelope = {
  data:{items:[{id:'plan_launch',slug:'launch',name:'Launch',summary:'A publish-approved launch plan.',profile:'website',currency:'KES',cadence:'monthly',amountMinor:250000,featureKeys:['pages'],quotas:[{key:'sites',label:'Sites',limit:1,unit:'count'}],promotion:null,checkoutAvailable:true,effectiveAt:'2026-07-01T00:00:00Z',expiresAt:'2026-08-01T00:00:00Z'}],page:{hasMore:false,nextCursor:null}},
  meta:{schemaVersion:1,datasetVersion:'pricing:1',etag:'"pricing-1"'},
} as const
export const expiredPricingEnvelope={...pricingEnvelope,data:{...pricingEnvelope.data,items:pricingEnvelope.data.items.map(item=>({...item,expiresAt:'2026-07-02T00:00:00Z'}))}}
export const editorialSource=`---\ntitle: Safe entry\ndescription: A safe public editorial entry.\nslug: safe-entry\ncollection: docs\nauthor: Fuma Docs\ncategory: Foundations\npublishedAt: 2026-07-26T00:00:00Z\nupdatedAt: 2026-07-26T00:00:00Z\nreviewAt: 2026-10-26T00:00:00Z\ndraft: false\nversion: 1.0\nredirects: []\ncomponents: []\nowner: Documentation\naudience: public\n---\n## Safe heading\n\nPublic copy.`
