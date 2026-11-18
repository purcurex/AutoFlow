/** A production deployment must bind credentials to one explicit HTTPS origin. */
export function confirmedFopOrigin(config) {
 const production=config.NODE_ENV==='production'||config.WORKBENCH_TIMESTAMP_ENVIRONMENT==='production'
 const expected=production?config.FOP_OPENAPI_ALLOWED_ORIGIN:'https://hyperzone.test.kdgalaxy.com'
 let url
 try {url=new URL(config.FOP_OPENAPI_BASE_URL||(production?'':expected))} catch {throw Error('timestamp_source_origin_invalid')}
 if(production&&(config.WORKBENCH_TIMESTAMP_ENVIRONMENT!=='production'||config.NODE_ENV!=='production')||!expected||url.protocol!=='https:'||url.origin!==expected||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('timestamp_source_origin_invalid')
 return url.origin
}
