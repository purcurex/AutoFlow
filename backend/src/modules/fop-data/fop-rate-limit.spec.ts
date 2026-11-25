import { admitRequest, ratePolicy, sourceRestriction, createBudgetedFetch, type BudgetState, type BudgetStore } from './fop-rate-limit'

const policy = ratePolicy({ get: () => undefined })
describe('FOP public-cloud shared admission', () => {
  test('defaults reserve capacity and reject settings above standard limits', () => {
    expect(policy).toMatchObject({ limits: [16, 400, 8000, 160000], intervalMs: 500 })
    for (const [key, value] of [['QPS','21'],['QPM','501'],['QPH','10001'],['QPD','200001']]) {
      expect(() => ratePolicy({ get: k => k === 'FOP_RATE_LIMIT_'+key ? value : undefined })).toThrow()
    }
  })
  test('all callers consume one spacing budget, including unsuccessful requests', () => {
    const first = admitRequest({}, 100000, policy)
    expect(first.allowed).toBe(true)
    expect(admitRequest(first.state, 100499, policy)).toMatchObject({ allowed:false, retryAfterMs:1 })
    expect(admitRequest(first.state, 100500, policy).allowed).toBe(true)
  })
  test.each([0,1,2,3])('each independent rolling limit blocks at its boundary: %s', dimension => {
    const now = 10*86400000+30000
    const state:BudgetState = { recent: Array(policy.limits[dimension]).fill(now-10), minutes:[[Math.floor(now/60000)*60000,8000]], hours:[[Math.floor(now/3600000)*3600000,160000]] }
    if(dimension>1) state.recent=[]
    if(dimension!==2) state.minutes=[]
    if(dimension!==3) state.hours=[]
    const result=admitRequest(state,now,policy)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe(['qps','qpm','qph','qpd'][dimension])
    expect(result.retryAfterMs).toBeGreaterThan(0)
  })
  test('hour/day boundaries do not reset rolling consumption; expired state is pruned', () => {
    const now=10*86400000
    const result=admitRequest({hours:[[now-3600000,160000]]},now,policy)
    expect(result).toMatchObject({allowed:false,reason:'qpd'})
    expect(admitRequest(result.state,now+86400000,policy).allowed).toBe(true)
  })
  test('cooldown survives successful in-flight replies and long Retry-After is honored', () => {
    expect(sourceRestriction(519,{messagecn:'请求被参数流控限制[网关]'},null,1000,0)).toMatchObject({kind:'rate',delayMs:60000})
    expect(sourceRestriction(200,{message:'请求被计费策略拦截限制[网关]'},null,1000,0)).toMatchObject({kind:'billing'})
    expect(sourceRestriction(429,{},'259200',1000,0)?.delayMs).toBe(259200000)
    expect(sourceRestriction(200,{status:true,errorCode:'0'},null,1000,0)).toBeNull()
    expect(admitRequest({blockedUntil:90000},50000,policy)).toMatchObject({allowed:false,retryAfterMs:40000})
  })
  test('official native codes classify limits without depending on translated messages', () => {
    for(const errorCode of ['2526','2528','429'])expect(sourceRestriction(519,{errorCode},null)?.kind).toBe('rate')
    expect(sourceRestriction(200,{errorCode:'2055'},null)?.kind).toBe('billing')
    expect(sourceRestriction(519,{errorCode:'2508'},null)).toBeNull()
  })
  test('deferred or aborted calls never reach the network; missing database fails closed', async () => {
    const network=jest.fn()
    const store:BudgetStore={reserve:async()=>({allowed:false,retryAfterMs:3600000,reason:'qph'}),restrict:async()=>{}}
    const request=createBudgetedFetch(store,network,policy)
    const response=await request('https://fop.example/kapi/query')
    expect(response.status).toBe(429);expect(network).not.toHaveBeenCalled()
    const controller=new AbortController();controller.abort()
    await expect(request('https://fop.example/kapi/query',{signal:controller.signal})).rejects.toThrow()
    store.reserve=async()=>{throw Error('private database detail')}
    const unavailable=await request('https://fop.example/kapi/query')
    expect(unavailable.status).toBe(503)
    expect(await unavailable.text()).not.toContain('private')
    expect(network).not.toHaveBeenCalled()
  })
  test('native 519/200 rate responses stop callers without replaying writes', async () => {
    for(const status of [200,519]){
      const store:BudgetStore={reserve:async()=>({allowed:true,retryAfterMs:0,reason:''}),restrict:jest.fn(async()=>{})}
      const network=jest.fn(async()=>new Response(JSON.stringify({errorCode:'unknown',messagecn:'请求被参数流控限制[网关]'}),{status}))
      const response=await createBudgetedFetch(store,network,policy)('https://fop.example/kapi/audit',{method:'POST'})
      expect(response.status).toBe(429);expect(store.restrict).toHaveBeenCalledTimes(1);expect(network).toHaveBeenCalledTimes(1)
    }
  })
  test('the central transport disables automatic redirects even when callers enable them', async()=>{
    const store:BudgetStore={reserve:async()=>({allowed:true,retryAfterMs:0,reason:''}),restrict:async()=>{}}
    const network=jest.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>new Response('{}'))
    await createBudgetedFetch(store,network,policy)(new Request('https://fop.example/kapi/audit',{redirect:'follow'}),{redirect:'follow'})
    expect(network.mock.calls[0][1]).toMatchObject({redirect:'error'})
  })
  test('broken rate-limit response streams do not produce unhandled promise rejections', async()=>{
    const store:BudgetStore={reserve:async()=>({allowed:true,retryAfterMs:0,reason:''}),restrict:async()=>{}}
    const network=async()=>new Response(new ReadableStream({start(c){c.error(Error('stream aborted'))}}),{status:429})
    const response=await createBudgetedFetch(store,network,policy)('https://fop.example/kapi/query')
    expect(response.status).toBe(429)
    await new Promise(resolve=>setTimeout(resolve,0))
  })
})
