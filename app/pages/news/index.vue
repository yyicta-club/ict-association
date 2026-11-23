<script lang="ts" setup>
import {news} from '~/data/content'

useSeoMeta({
  title: '协会动态 · 信息通信技术协会',
  description: '查看协会公告、Minecraft 社区更新及到梦空间部落加入指引。'
})
useReveal()
const category = ref('全部动态')
const categories = ['全部动态', '社区共创', '协会公告', '认识我们']
const filtered = computed(() => category.value === '全部动态' ? news : news.filter(item => item.category === category.value))
</script>

<template>
  <div class="container news-page">
    <section class="page-intro"><span class="eyebrow">THE LATEST / 协会动态</span>
      <h1>每一次发生，<br/>都值得<span class="text-lime">被看见。</span></h1>
      <p>记录我们的更新、相遇与共同创造。</p></section>
    <div aria-label="筛选动态类别" class="news-filter" role="group">
      <button v-for="item in categories" :key="item" :aria-pressed="category === item"
              :class="{ active: category === item }" @click="category = item">{{ item }}
      </button>
      <span aria-live="polite" class="mono">{{ String(filtered.length).padStart(2, '0') }} STORIES</span></div>
    <div class="article-grid">
      <NuxtLink v-for="item in filtered" :key="item.slug" :to="`/news/${item.slug}`" class="article-card">
        <div :class="item.slug" class="article-cover"><img v-if="item.image" :src="item.image"
                                                           alt="Minecraft 世界中的森林与天空" height="520" width="990"/>
          <template v-else><span class="mono">{{
              item.category === '协会公告' ? 'FIND YOUR PEOPLE' : 'HELLO, WORLD.'
            }}</span>
            <AppIcon :name="item.category === '协会公告' ? 'users' : 'code'" :size="85"/>
            <span>{{ item.category === '协会公告' ? '在这里，连接彼此。' : '从这里，一起出发。' }}</span></template>
          <span class="article-cover-arrow"><AppIcon :size="22" name="diagonal"/></span></div>
        <div class="news-meta"><span class="tag">{{ item.category }}</span>
          <time :datetime="item.date.replaceAll('.', '-')" class="mono">{{ item.date }}</time>
        </div>
        <h2>{{ item.title }}</h2>
        <p>{{ item.description }}</p></NuxtLink>
    </div>
    <div class="news-end mono">YOU'RE ALL CAUGHT UP <span>✳</span> 更多故事，正在路上。</div>
    <div class="banner-wrapper">
      <JoinBanner/>
    </div>
  </div>
</template>
