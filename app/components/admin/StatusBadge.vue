<script setup lang="ts">
import type {MessageStatus, PostStatus} from '~/data/admin'

const props = defineProps<{status: PostStatus | MessageStatus}>()

const map = {
    published: {label: '已发布', tone: 'is-green'},
    draft: {label: '草稿', tone: 'is-grey'},
    review: {label: '待审核', tone: 'is-peach'},
    pending: {label: '待处理', tone: 'is-peach'},
    replied: {label: '已回复', tone: 'is-green'},
    ignored: {label: '已忽略', tone: 'is-grey'}
} as const

const item = computed(() => map[props.status])
</script>

<template>
  <span class="admin-tag" :class="item.tone">
    <span class="status-dot" :style="{width: '4px', height: '4px', background: 'currentColor', boxShadow: 'none'}"/>
    {{ item.label }}
  </span>
</template>
