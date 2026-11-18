<script setup lang="ts">
useSeoMeta({ title: '加入我们 · 信息通信技术协会', description: '带上好奇心，加入信息通信技术协会。扫描到梦空间部落二维码，找到一起探索技术的伙伴。' })
useReveal()
const openFaq = ref<number | null>(0)
const copyState = ref('复制协会名称')
let timer: ReturnType<typeof setTimeout> | undefined
const faqs = [
  { q: '没有编程基础，也可以加入吗？', a: '欢迎带着好奇心来认识我们。你可以从 Web 基础和电脑使用等话题开始交流。具体招新条件与入会流程，请以协会发布的正式通知为准。' },
  { q: '协会平时主要做什么？', a: '日常授课主要围绕 Web 前端开发与设计，同时提供电脑问题交流、设备维护经验分享、竞赛交流，以及 Minecraft 社区共创。' },
  { q: '怎么获得活动通知和参与方式？', a: '可以先通过到梦空间加入协会部落，关注平台内通知。具体授课、活动报名、群聊加入等安排，请查看协会正式通知或联系协会负责人。' },
  { q: '怎么加入 Minecraft 服务器？', a: '请在协会群内获取当前连接地址、客户端文件及社区规则。网站展示的是 2026 年 11 月 11 日的更新公告，实时状态和版本以群内通知为准。' }
]
async function copyName() {
  try { await navigator.clipboard.writeText('信息通信技术协会'); copyState.value = '名称已复制' } catch { copyState.value = '请长按选择：信息通信技术协会' }
  clearTimeout(timer)
  timer = setTimeout(() => { copyState.value = '复制协会名称' }, 3000)
}
onUnmounted(() => clearTimeout(timer))
</script>

<template>
  <div class="container join-page"><section class="page-intro"><span class="eyebrow"><span class="status-dot" /> THERE'S A PLACE FOR YOU</span><h1>下一行代码，<br /><span class="text-lime">和我们一起写。</span></h1><p>无论起点在哪，热爱总能让我们相遇。<br />带上你的好奇心，来认识一些同频的人。</p></section><section class="join-layout"><div class="join-steps"><span class="eyebrow">HOW TO FIND US / 找到组织</span><article><span class="step-number mono">01</span><div><h2>打开「到梦空间」</h2><p>使用你的学校账号登录到梦空间，进入部落页面。</p></div></article><article><span class="step-number mono">02</span><div><h2>找到信息通信技术协会</h2><p>扫描右侧二维码，或在部落中搜索协会名称。</p><button class="text-link" @click="copyName"><AppIcon name="copy" :size="15" /><span aria-live="polite">{{ copyState }}</span></button></div></article><article><span class="step-number mono">03</span><div><h2>加入部落，开启探索</h2><p>关注协会活动通知。具体入会和群聊安排，请按协会正式通知操作。</p></div></article><p class="join-small-note"><AppIcon name="spark" :size="16" /> 二维码来自协会 2026.11.08 公告。若扫码失效，可搜索协会名称。</p></div><div class="qr-card"><div class="qr-card-top"><span class="brand-mark"><AppIcon name="code" :size="23" /></span><span class="mono">SCAN. CONNECT. CREATE.</span></div><h2>你的下一站，<br />在这里。</h2><div class="qr-image-wrap"><img src="/images/join-qr.png" alt="信息通信技术协会到梦空间部落加入二维码" width="280" height="280" /></div><strong>到梦空间 · 信息通信技术协会</strong><span class="qr-caption">保存二维码，在到梦空间中识别</span><a href="/images/join-qr.png" download="信息通信技术协会-到梦空间.png" class="button button-outline">保存加入二维码 <AppIcon name="down" :size="17" /></a></div></section><section class="faq-section section"><div><span class="eyebrow">A FEW THINGS TO KNOW</span><h2>你可能想知道<span class="text-lime">。</span></h2><p>更多问题，欢迎加入后一起聊聊。</p></div><div class="faq-list"><article v-for="(faq, index) in faqs" :key="faq.q"><button :aria-expanded="openFaq === index" :aria-controls="`faq-${index}`" @click="openFaq = openFaq === index ? null : index"><span>{{ faq.q }}</span><AppIcon :name="openFaq === index ? 'close' : 'plus'" :size="18" /></button><p v-if="openFaq === index" :id="`faq-${index}`">{{ faq.a }}</p></article></div></section></div>
</template>
