<script setup lang="ts">
const props = defineProps<{
    items: {name: string, value: number, color: string}[]
    unit?: string
}>()

const R = 62
const CIRCUMFERENCE = 2 * Math.PI * R
const total = computed(() => props.items.reduce((sum, item) => sum + item.value, 0))

const segments = computed(() => {
    let offset = 0
    return props.items.map((item, index) => {
        const ratio = total.value ? item.value / total.value : 0
        const length = ratio * CIRCUMFERENCE
        const segment = {
            ...item,
            length,
            gap: CIRCUMFERENCE - length,
            offset: -offset,
            ratio,
            delay: `${index * 130}ms`
        }
        offset += length
        return segment
    })
})
</script>

<template>
  <div class="admin-donut-wrap">
    <div class="admin-donut">
      <svg viewBox="0 0 160 160" role="img" aria-label="分类分布环形图">
        <circle class="donut-track" cx="80" cy="80" :r="R"/>
        <circle v-for="segment in segments" :key="segment.name" class="donut-seg" cx="80" cy="80" :r="R"
                :stroke="segment.color"
                :stroke-dasharray="`${segment.length} ${segment.gap}`"
                :stroke-dashoffset="segment.offset"
                :style="{animationDelay: segment.delay}"/>
      </svg>
      <div class="admin-donut-center">
        <div>
          <strong>{{ total }}</strong>
          <small>{{ unit || '总计' }}</small>
        </div>
      </div>
    </div>

    <div class="admin-legend">
      <div v-for="segment in segments" :key="segment.name" class="admin-legend-item">
        <span class="admin-legend-swatch" :style="{background: segment.color}"/>
        <span>{{ segment.name }}</span>
        <b>{{ segment.value }}</b>
      </div>
    </div>
  </div>
</template>
