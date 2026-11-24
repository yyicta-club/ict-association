import type {Ref} from 'vue'

/**
 * 数字滚动动画：从 0 缓动到目标值。
 * 尊重 prefers-reduced-motion；SSR 首屏渲染 0，客户端挂载后开始滚动。
 */
export function useCountUp(source: Ref<number>, duration = 1400) {
    const value = ref(0)
    let raf = 0

    onMounted(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            value.value = source.value
            return
        }
        const start = performance.now()
        const from = 0
        const to = source.value
        const tick = (now: number) => {
            const progress = Math.min(1, (now - start) / duration)
            const eased = 1 - Math.pow(1 - progress, 3)
            value.value = from + (to - from) * eased
            if (progress < 1) raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
    })

    onUnmounted(() => cancelAnimationFrame(raf))
    return value
}
