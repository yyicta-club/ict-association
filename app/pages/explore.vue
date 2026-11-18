<script setup lang="ts">
import { directions } from '~/data/content'
useSeoMeta({ title: '探索方向 · 信息通信技术协会', description: '探索 Web 前端开发、硬件网络、竞赛实践与 Minecraft 社区共创，找到你的技术成长方向。' })
useReveal()
const activeAccordion = ref<string | null>('web')
</script>

<template>
  <div class="container">
    <section class="page-intro"><span class="eyebrow">THE PLAYGROUND / 探索方向</span><h1>让好奇心，<br /><span class="text-lime">有处可去。</span></h1><p>从一个小问题开始，到完成自己的作品。<br />四个探索方向，无数种成长的可能。</p><nav class="direction-tabs" aria-label="探索方向目录"><a v-for="item in directions" :key="item.id" :href="`#${item.id}`"><span class="mono">{{ item.number }}</span>{{ item.title }}<AppIcon name="down" :size="14" /></a></nav></section>
    <section v-for="item in directions" :id="item.id" :key="item.id" class="explore-detail reveal" :class="`direction-${item.color}`"><div class="explore-visual"><span class="mono">FIELD / {{ item.number }}</span><div class="explore-glyph"><AppIcon :name="item.icon" :size="110" /></div><span class="mono">{{ item.en }}</span></div><div class="explore-body"><div class="explore-heading"><span class="eyebrow">{{ item.en }}</span><span class="mono muted">0{{ item.number.slice(1) }} / 04</span></div><h2>{{ item.title }}</h2><p>{{ item.description }}</p><div class="tags"><span v-for="tag in item.tags" :key="tag" class="tag">{{ tag }}</span></div><button class="accordion-trigger" :aria-expanded="activeAccordion === item.id" :aria-controls="`path-${item.id}`" @click="activeAccordion = activeAccordion === item.id ? null : item.id">从这里开始探索 <AppIcon :name="activeAccordion === item.id ? 'close' : 'plus'" :size="17" /></button><div v-if="activeAccordion === item.id" :id="`path-${item.id}`" class="learning-path"><p class="path-note">{{ item.id === 'web' ? '参考成长路径 · 具体授课安排以群内通知为准' : '探索建议 · 与协会伙伴一起交流实践' }}</p><ol><li v-for="(lesson, index) in item.lessons" :key="lesson"><span class="mono">0{{ index + 1 }}</span>{{ lesson }}</li></ol></div><NuxtLink :to="item.id === 'community' ? '/news/minecraft-update-1-0' : '/join'" class="text-link">{{ item.id === 'community' ? '看看我们的世界' : '找到一起探索的伙伴' }} <AppIcon name="diagonal" :size="16" /></NuxtLink></div></section>
    <div class="banner-wrapper"><JoinBanner /></div>
  </div>
</template>
