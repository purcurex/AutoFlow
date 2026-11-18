import {environmentFiles} from './env-files'
describe('production config boundary',()=>{
 it('production process ignores all private test files',()=>expect(environmentFiles({NODE_ENV:'production'},'')).toEqual(['.env']))
 it('production declaration in base file ignores private files even without process NODE_ENV',()=>expect(environmentFiles({},'NODE_ENV=production\n')).toEqual(['.env']))
 it('development retains existing private overrides',()=>expect(environmentFiles({NODE_ENV:'development'},'')).toContain('.env.workbench.local'))
})
