import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity'
import { AiPromptBindingEntity } from './ai-prompt-binding.entity'
import { AiPromptTemplateEntity } from './ai-prompt-template.entity'
import { AI_PROMPT_MODULES, AI_PROMPT_VARIABLES, SYSTEM_PROMPT_TEMPLATES, type AiPromptModuleKey } from './prompt-template.types'

@Injectable()
export class PromptTemplateService implements OnModuleInit {
  constructor(
    @InjectRepository(AiPromptTemplateEntity)
    private readonly templateRepository: Repository<AiPromptTemplateEntity>,
    @InjectRepository(AiPromptBindingEntity)
    private readonly bindingRepository: Repository<AiPromptBindingEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.templateRepository.upsert(
      SYSTEM_PROMPT_TEMPLATES.map((template) => ({
        ...template,
        ownerUserId: null,
        isSystem: true,
      })) as QueryDeepPartialEntity<AiPromptTemplateEntity>[],
      { conflictPaths: ['id'], skipUpdateIfNoValuesChanged: true },
    )
  }

  async listModules(ownerUserId: string) {
    const [templates, bindings] = await Promise.all([
      this.templateRepository
        .createQueryBuilder('template')
        .where('template.is_system = true OR template.owner_user_id = :ownerUserId', { ownerUserId })
        .orderBy('template.is_system', 'DESC')
        .addOrderBy('template.created_at', 'ASC')
        .getMany(),
      this.bindingRepository.find({ where: { ownerUserId } }),
    ])
    const bindingByModule = new Map(bindings.map((binding) => [binding.moduleKey, binding.templateId]))

    return {
      variables: AI_PROMPT_VARIABLES,
      modules: AI_PROMPT_MODULES.map((moduleKey) => {
        const moduleTemplates = templates.filter((template) => template.moduleKey === moduleKey)
        const systemDefault = moduleTemplates.find((template) => template.isSystem)
        if (!systemDefault) throw new NotFoundException(`System prompt template missing for module: ${moduleKey}`)
        const activeTemplateId = bindingByModule.get(moduleKey) || systemDefault.id
        return {
          moduleKey,
          activeTemplateId,
          systemDefaultTemplateId: systemDefault.id,
          templates: moduleTemplates.map((template) => ({
            id: template.id,
            moduleKey: template.moduleKey,
            name: template.name,
            content: template.content,
            isSystem: template.isSystem,
            isActive: template.id === activeTemplateId,
            createdAt: template.createdAt.toISOString(),
            updatedAt: template.updatedAt.toISOString(),
          })),
        }
      }),
    }
  }

  async create(ownerUserId: string, input: { moduleKey: AiPromptModuleKey; name: string; content: string }) {
    this.assertModule(input.moduleKey)
    const saved = await this.templateRepository.save(this.templateRepository.create({
      ownerUserId,
      moduleKey: input.moduleKey,
      name: input.name.trim(),
      content: input.content.trim(),
      isSystem: false,
    }))
    return saved
  }

  async update(ownerUserId: string, id: string, input: { name: string; content: string }) {
    const template = await this.findOwned(ownerUserId, id)
    template.name = input.name.trim()
    template.content = input.content.trim()
    return this.templateRepository.save(template)
  }

  async remove(ownerUserId: string, id: string): Promise<void> {
    const template = await this.findOwned(ownerUserId, id)
    await this.templateRepository.remove(template)
  }

  async activate(ownerUserId: string, moduleKey: AiPromptModuleKey, templateId: string): Promise<void> {
    this.assertModule(moduleKey)
    const template = await this.templateRepository
      .createQueryBuilder('template')
      .where('template.id = :templateId', { templateId })
      .andWhere('(template.is_system = true OR template.owner_user_id = :ownerUserId)', { ownerUserId })
      .getOne()
    if (!template || template.moduleKey !== moduleKey) throw new NotFoundException('Prompt template not found for this module')
    await this.bindingRepository.upsert(
      { ownerUserId, moduleKey, templateId } as QueryDeepPartialEntity<AiPromptBindingEntity>,
      { conflictPaths: ['ownerUserId', 'moduleKey'], skipUpdateIfNoValuesChanged: true },
    )
  }

  async resolve(
    ownerUserId: string,
    moduleKeys: AiPromptModuleKey[],
    variables: Record<string, string | null>,
  ): Promise<string[]> {
    const catalog = await this.listModules(ownerUserId)
    return moduleKeys.map((moduleKey) => {
      const module = catalog.modules.find((item) => item.moduleKey === moduleKey)!
      const template = module.templates.find((item) => item.id === module.activeTemplateId)!
      return this.render(template.content, variables)
    })
  }

  private render(content: string, variables: Record<string, string | null>): string {
    return content.replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g, (placeholder, key: string) => (
      Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] || '' : placeholder
    ))
  }

  private async findOwned(ownerUserId: string, id: string): Promise<AiPromptTemplateEntity> {
    const template = await this.templateRepository.findOne({ where: { id, ownerUserId, isSystem: false } })
    if (!template) throw new NotFoundException('Custom prompt template not found')
    return template
  }

  private assertModule(moduleKey: string): asserts moduleKey is AiPromptModuleKey {
    if (!AI_PROMPT_MODULES.includes(moduleKey as AiPromptModuleKey)) throw new NotFoundException('Prompt module not found')
  }
}
