<script setup lang="ts">
import { directions, news } from '~/data/content'
useSeoMeta({ title: '信息通信技术协会 · 保持好奇，创造可能', description: '信息工程学院直属协会。探索 Web 开发、硬件网络与创意实践，和有趣的人，一起创造有意思的事。' })
// useReveal()
</script>

<template>
  <div>
    <section class="hero container" aria-labelledby="hero-title">
      <div class="hero-copy">
        <div class="hero-eyebrow"><span class="status-dot" /> 信息工程学院直属协会 <span class="eyebrow-divider" /><span class="mono">HELLO, FUTURE.</span></div>
        <h1 id="hero-title">保持好奇。<br />一起，<span class="text-lime">创造可能<span class="title-period">。</span></span></h1>
        <p class="hero-description">这里是信息通信技术协会。<br />一群热爱技术的人，一个让想法发生的地方。<br class="desktop-only" />从第一行代码，到下一个不止于想象的作品。</p>
        <div class="hero-actions"><NuxtLink to="/explore" class="button button-lime">开始探索 <AppIcon name="diagonal" :size="18" /></NuxtLink><NuxtLink to="/about" class="button button-quiet"><span class="circle-play"><AppIcon name="play" :size="12" /></span>认识一下，我们</NuxtLink></div>
        <div class="hero-community"><div class="community-avatars" aria-hidden="true"><span>⌘</span><span>✳</span><span>&lt;/&gt;</span><span>↗</span></div><div><strong>同频的人，已经在这里。</strong><span>不设起点，只要你有好奇心 <AppIcon name="spark" :size="12" /></span></div></div>
      </div>
      <div class="hero-art"><ParticleSculpture /></div>
      <div class="hero-bottom"><a href="#directions" class="scroll-cue"><span class="scroll-box"><AppIcon name="down" :size="14" /></span><span class="mono">SCROLL TO DISCOVER</span></a><span class="hero-manifesto">学习 · 分享 · 共创 <span class="mono">/ MORE THAN A CLUB</span></span><span class="mono hero-index">01 — 04</span></div>
    </section>

    <div class="tech-strip" aria-label="探索、编程、连接、创造"><div class="container tech-strip-inner"><span>EXPLORE <i>↗</i></span><span>CODE <i>✳</i></span><span>CONNECT <i>↗</i></span><span>CREATE <i>✳</i></span><span class="strip-last">REPEAT <i>↗</i></span></div></div>

    <section id="directions" class="section container">
      <div class="section-heading reveal"><div><span class="eyebrow"><span class="section-number">01 /</span> FIND YOUR PASSION</span><h2>热爱不设限，<br />探索有方向<span class="text-lime">。</span></h2></div><div class="section-heading-aside"><p>不必一开始就很厉害。<br />在动手、交流和协作中，找到自己的主场。</p><NuxtLink to="/explore" class="text-link">找到你的方向 <AppIcon name="diagonal" :size="16" /></NuxtLink></div></div>
      <div class="direction-grid reveal"><NuxtLink v-for="item in directions" :key="item.id" :to="`/explore#${item.id}`" class="direction-card" :class="`direction-${item.color}`"><div class="direction-card-top"><span class="direction-icon"><AppIcon :name="item.icon" :size="27" /></span><span class="mono direction-number">{{ item.number }}</span></div><span class="direction-en mono">{{ item.en }}</span><h3>{{ item.title }}</h3><p>{{ item.description }}</p><div class="direction-card-bottom"><span>{{ item.tags[0] }} <i>·</i> {{ item.tags[1] }}</span><span class="card-arrow"><AppIcon name="diagonal" :size="19" /></span></div></NuxtLink></div>
    </section>

    <section class="about-teaser section container">
      <div class="terminal-art reveal"><div class="terminal-titlebar"><div class="window-dots"><i /><i /><i /></div><span class="mono">~/ict-association/hello.ts</span><AppIcon name="code" :size="16" /></div><div class="terminal-code mono"><div><span class="line-number">01</span><span class="code-comment">// 一个让热爱持续发生的地方</span></div><div><span class="line-number">02</span><span><b>const</b> association = {</span></div><div><span class="line-number">03</span><span>&nbsp; spirit: <em>'保持好奇'</em>,</span></div><div><span class="line-number">04</span><span>&nbsp; mode: <em>'一起成长'</em>,</span></div><div><span class="line-number">05</span><span>&nbsp; possibilities: <b>Infinity</b></span></div><div><span class="line-number">06</span><span>};</span></div><div><span class="line-number">07</span><span>&nbsp;</span></div><div><span class="line-number">08</span><span>you.<strong>join</strong>(association);<i class="code-cursor" /></span></div></div><div class="terminal-output mono"><span>➜</span> Hello, new possibilities.<AppIcon name="spark" :size="15" /></div><span class="terminal-sticker">BETTER<br /><strong>TOGETHER.</strong><AppIcon name="diagonal" :size="25" /></span></div>
      <div class="about-teaser-copy reveal"><span class="eyebrow"><span class="section-number">02 /</span> A PLACE TO BELONG</span><h2>一个协会。<br />不止一种可能。</h2><p>我们是信息工程学院直属的信息通信技术协会。比起独自摸索，我们更相信一起探索的力量。</p><p>从 Web 前端教学到电脑问题答疑，从竞赛交流到游戏世界共创。在这里，知识被分享，想法被回应，每一份热爱都能找到同伴。</p><NuxtLink to="/about" class="text-link">了解我们的故事 <AppIcon name="diagonal" :size="17" /></NuxtLink></div>
    </section>

    <section class="news-section section container">
      <div class="section-heading reveal"><div><span class="eyebrow"><span class="section-number">03 /</span> WHAT'S HAPPENING</span><h2>新鲜事，正在发生<span class="text-lime">。</span></h2></div><NuxtLink to="/news" class="text-link">全部动态 <AppIcon name="diagonal" :size="16" /></NuxtLink></div>
      <div class="home-news-grid reveal"><NuxtLink :to="`/news/${news[0]!.slug}`" class="featured-news"><div class="featured-news-image"><img src="/images/minecraft-world.jpg" alt="协会 Minecraft 世界中的森林与天空" width="990" height="520" loading="lazy" /><span class="image-label mono"><span class="status-dot" /> OUR LITTLE UNIVERSE</span><span class="image-arrow"><AppIcon name="diagonal" :size="25" /></span></div><div class="news-meta"><span class="tag">{{ news[0]!.category }}</span><time class="mono" datetime="2026-11-11">{{ news[0]!.date }}</time></div><h3>{{ news[0]!.title }}</h3><p>{{ news[0]!.description }}</p></NuxtLink><div class="news-list"><NuxtLink v-for="item in news.slice(1)" :key="item.slug" :to="`/news/${item.slug}`" class="news-list-item"><div class="news-meta"><span class="tag">{{ item.category }}</span><time class="mono" :datetime="item.date.replaceAll('.', '-')">{{ item.date }}</time></div><h3>{{ item.title }}</h3><p>{{ item.description }}</p><span class="news-read">阅读详情 <AppIcon name="diagonal" :size="16" /></span></NuxtLink></div></div>
    </section>
    <div class="container banner-wrapper"><JoinBanner /></div>
  </div>
</template>
