<script setup lang="ts">
const props = withDefaults(defineProps<{
    label: string
    value: number
    delta: number
    icon: string
    series?: number[]
    caption?: string
    tone?: string
    invert?: boolean
}>(), {series: () => [], caption: '', tone: '#c2f970', invert: false})

const animated = useCountUp(toRef(props, 'value'))

const isUp = computed(() => props.delta >= 0)
const deltaClass = computed(() => {
    if (isUp.value) return 'is-up'
    return props.invert ? 'is-down is-good' : 'is-down'
})

const sparkPath = computed(() => {
    const data = props.series
    if (data.length < 2) return ''
    const max = Math.max(...data)
    const min = Math.min(...data)
    const span = max - min || 1
    return data.map((value, index) => {
        const x = (index / (data.length - 1)) * 92
        const y = 30 - ((value - min) / span) * 26
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    }).join(' ')
})

const sparkArea = computed(() => {
    if (!sparkPath.value) return ''
    return `${sparkPath.value} L92 32 L0 32 Z`
})
</script>

<template>
  <article class="admin-panel admin-stat" :style="{'--tone': tone}">
    <div class="admin-stat-top">
      <span class="admin-stat-label">{{ label }}</span>
      <span class="admin-stat-icon">
        <AdminIcon :name="icon" :size="15"/>
      </span>
    </div>

    <div>
      <div class="admin-stat-value">
        <span>{{ Math.round(animated).toLocaleString() }}</span>
        <span class="admin-delta" :class="deltaClass">
          <AdminIcon :name="isUp ? 'arrow-up' : 'arrow-down'" :size="10"/>
          {{ Math.abs(delta).toFixed(1) }}%
        </span>
      </div>
      <p v-if="caption" class="admin-stat-caption">{{ caption }}</p>
    </div>

    <div class="admin-stat-foot">
      <span/>
      <svg v-if="sparkPath" class="admin-spark" viewBox="0 0 92 32" preserveAspectRatio="none" aria-hidden="true">
        <path class="spark-area" :d="sparkArea"/>
        <path :d="sparkPath"/>
      </svg>
    </div>
  </article>
</template>
