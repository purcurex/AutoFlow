import type { InjectionKey, Ref } from 'vue'

export const workbenchRefreshTarget: InjectionKey<Ref<HTMLElement | null>> = Symbol('workbenchRefreshTarget')
