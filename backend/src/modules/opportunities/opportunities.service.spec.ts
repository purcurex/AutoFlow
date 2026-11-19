import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { OpportunitiesService } from './opportunities.service'
import { User } from '../users/user.entity'

describe('opportunity permission boundary', () => {
  it('rejects disabled accounts before any local business read', async () => {
    const repo={findOne:async()=>({id:'a',accountDisabled:true,role:'admin'})}
    const source={getRepository:()=>repo}
    await expect(new OpportunitiesService(source as any).list('a',{})).rejects.toBeInstanceOf(UnauthorizedException)
  })
  it('rejects a missing account before options or query', async () => {
    const source={getRepository:()=>({findOne:async()=>null})}
    await expect(new OpportunitiesService(source as any).options('a')).rejects.toBeInstanceOf(UnauthorizedException)
  })
  it('honors existing business access denial', async () => {
    const source={getRepository:()=>({findOne:async()=>({id:'a',accountDisabled:false,role:'user',businessRole:'none'})})}
    await expect(new OpportunitiesService(source as any).list('a',{})).rejects.toBeInstanceOf(ForbiddenException)
  })
})
