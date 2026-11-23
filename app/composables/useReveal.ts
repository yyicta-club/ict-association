export function useReveal() {
    let observer: IntersectionObserver | undefined
    onMounted(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
        observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible')
                    observer?.unobserve(entry.target)
                }
            })
        }, {threshold: 0.08})
        document.querySelectorAll('.reveal').forEach(element => {
            if (element.getBoundingClientRect().top > window.innerHeight * .9) {
                element.classList.add('will-reveal')
                observer?.observe(element)
            }
        })
    })
    onUnmounted(() => observer?.disconnect())
}
