export interface ToastItem {
    id: number
    title: string
    description?: string
    type: 'success' | 'info' | 'error'
}

const state = reactive<{toasts: ToastItem[]}>({toasts: []})
let seed = 0

export function useToast() {
    function push(toast: Omit<ToastItem, 'id'>) {
        const id = ++seed
        state.toasts.push({id, ...toast})
        setTimeout(() => remove(id), 3400)
    }

    function remove(id: number) {
        const index = state.toasts.findIndex(item => item.id === id)
        if (index > -1) state.toasts.splice(index, 1)
    }

    return {
        toasts: computed(() => state.toasts),
        push,
        remove
    }
}
