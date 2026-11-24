<script setup lang="ts">
const props = withDefaults(defineProps<{
    series: {label: string, value: number}[]
    height?: number
}>(), {height: 220})

const W = 720
const H = 220
const padX = 18
const padTop = 22
const padBottom = 30

const max = computed(() => Math.max(...props.series.map(item => item.value), 1) * 1.15)
const min = computed(() => Math.min(...props.series.map(item => item.value), 0) * 0.85)

function xAt(index: number) {
    const span = W - padX * 2
    const step = props.series.length > 1 ? span / (props.series.length - 1) : span
    return padX + step * index
}

function yAt(value: number) {
    const span = H - padTop - padBottom
    const ratio = (value - min.value) / (max.value - min.value || 1)
    return padTop + span - ratio * span
}

const points = computed(() => props.series.map((item, index) => ({
    x: xAt(index),
    y: yAt(item.value),
    ...item
})))

const linePath = computed(() => points.value
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' '))

const areaPath = computed(() => {
    if (points.value.length < 2) return ''
    const first = points.value[0]!
    const last = points.value[points.value.length - 1]!
    return `${linePath.value} L${last.x.toFixed(1)} ${H - padBottom} L${first.x.toFixed(1)} ${H - padBottom} Z`
})

const gridLines = computed(() => {
    const lines: {y: number, value: number}[] = []
    for (let i = 0; i <= 3; i++) {
        const ratio = i / 3
        const value = max.value - (max.value - min.value) * ratio
        lines.push({y: padTop + (H - padTop - padBottom) * ratio, value})
    }
    return lines
})

const active = ref<number | null>(null)
const tooltipStyle = computed(() => {
    const point = active.value === null ? undefined : points.value[active.value]
    if (!point) return {}
    return {left: `${(point.x / W) * 100}%`, top: `${(point.y / H) * 100}%`}
})
</script>

<template>
  <div class="admin-chart">
    <svg :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="访问趋势图">
      <defs>
        <linearGradient id="adminAreaGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#c2f970" stop-opacity=".26"/>
          <stop offset="100%" stop-color="#c2f970" stop-opacity="0"/>
        </linearGradient>
      </defs>

      <g v-for="line in gridLines" :key="line.y">
        <line class="grid-line" :x1="padX" :x2="W - padX" :y1="line.y" :y2="line.y"/>
        <text class="axis-label" :x="padX" :y="line.y - 6">{{ Math.round(line.value) }}</text>
      </g>

      <path class="area-path" :d="areaPath"/>
      <path class="line-path" :d="linePath"/>

      <g v-for="(point, index) in points" :key="point.label">
        <circle class="point" :cx="point.x" :cy="point.y" r="3.4" :style="{animationDelay: `${index * 90}ms`}"/>
        <circle class="point-hit" :cx="point.x" :cy="point.y" r="16"
                @mouseenter="active = index" @mouseleave="active = null"/>
        <text class="axis-label" :x="point.x" :y="H - 10" text-anchor="middle">{{ point.label }}</text>
      </g>
    </svg>

    <Transition name="admin-fade">
      <div v-if="active !== null && points[active]" class="admin-chart-tooltip" :style="tooltipStyle">
        <strong>{{ points[active]!.value.toLocaleString() }}</strong>
        <small>{{ points[active]!.label }}</small>
      </div>
    </Transition>
  </div>
</template>
