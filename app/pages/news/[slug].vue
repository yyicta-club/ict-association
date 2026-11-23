<script setup lang="ts">
import {news} from '~/data/content'

const route = useRoute()
const article = news.find(item => item.slug === route.params.slug)
if (!article) throw createError({statusCode: 404, statusMessage: '这篇动态暂时不存在'})
useSeoMeta({title: `${article.title} · 信息通信技术协会`, description: article.description})
const related = news.filter(item => item.slug !== article.slug)
const copyState = ref('复制链接')
let copyTimer: ReturnType<typeof setTimeout> | undefined

async function copyLink() {
  try {
    await navigator.clipboard.writeText(window.location.href);
    copyState.value = '链接已复制'
  } catch {
    copyState.value = '请从地址栏复制链接'
  }
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => {
    copyState.value = '复制链接'
  }, 2500)
}

onUnmounted(() => clearTimeout(copyTimer))
useReveal()
</script>

<template>
  <div v-if="article" class="container">
    <article class="article-detail">
      <NuxtLink to="/news" class="text-link article-back">
        <AppIcon name="arrow" :size="16"/>
        返回全部动态
      </NuxtLink>
      <div class="news-meta"><span class="tag">{{ article.category }}</span>
        <time class="mono" :datetime="article.date.replaceAll('.', '-')">{{ article.date }}</time>
      </div>
      <h1>{{ article.title }}</h1>
      <p class="article-lead">{{ article.description }}</p>
      <div class="article-byline"><span><AppIcon name="code" :size="18"/> 信息通信技术协会</span>
        <button class="text-link" @click="copyLink">
          <AppIcon name="copy" :size="15"/>
          <span aria-live="polite">{{ copyState }}</span></button>
      </div>
      <img v-if="article.image" :src="article.image" alt="协会 Minecraft 世界中的森林与天空" class="article-hero-image"
           width="990" height="520"/>
      <div class="article-prose"><p v-for="paragraph in article.paragraphs" :key="paragraph">{{ paragraph }}</p></div>
      <div v-if="article.slug === 'join-our-tribe'" class="article-qr"><img src="/images/join-qr.png"
                                                                            alt="到梦空间信息通信技术协会部落二维码"
                                                                            width="240" height="240"/>
        <p>使用「到梦空间」扫码加入部落</p></div>
      <div class="article-callout">
        <AppIcon name="spark" :size="25"/>
        <div><strong>找到伙伴，让故事继续。</strong>
          <p>活动安排、服务地址与最新消息，请以协会群内正式通知为准。</p></div>
        <NuxtLink to="/join" class="text-link">加入我们
          <AppIcon name="diagonal" :size="16"/>
        </NuxtLink>
      </div>
      <p class="article-source">内容整理自协会公告 · {{ article.date }}</p></article>
    <section class="related-section">
      <div class="section-heading"><h2>继续探索</h2><span class="mono muted">MORE STORIES</span></div>
      <div class="related-grid">
        <NuxtLink v-for="item in related" :key="item.slug" :to="`/news/${item.slug}`"><span
            class="eyebrow">{{ item.category }}</span>
          <h3>{{ item.title }}</h3>
          <AppIcon name="diagonal" :size="22"/>
        </NuxtLink>
      </div>
    </section>
  </div>
</template>
