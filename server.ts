import express from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { generateMockArticles, generateMockComments, AUTHORS } from './src/data/mockData';
import { Article, Comment, Category, LiveStats } from './src/types';

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

// Initialize Server State (In-Memory Database)
let articles: Article[] = generateMockArticles();
let comments: Comment[] = generateMockComments();
const authors = AUTHORS;

// Active and live engagement trackers
let activeVisitors = 14210;
let totalShares = articles.reduce((acc, a) => acc + a.shares, 0);
let totalLikes = articles.reduce((acc, a) => acc + a.likes, 0);
let totalViews = articles.reduce((acc, a) => acc + a.views, 0);
let totalReactions = articles.reduce((acc, a) => {
  return acc + (a.reactions.love + a.reactions.wow + a.reactions.sad + a.reactions.angry);
}, 0);

// Initialize Category View Stats
const categoryViews: Record<Category, number> = {
  politics: 0,
  business: 0,
  technology: 0,
  world: 0,
  sports: 0,
  entertainment: 0,
  lifestyle: 0,
};

articles.forEach(art => {
  if (categoryViews[art.category] !== undefined) {
    categoryViews[art.category] += art.views;
  }
});

// Recent live interactions history feed
let recentActivityList: LiveStats['recentActivity'] = [
  { id: 'act-1', type: 'view', description: 'Reader opened "Jakarta MRT Phase 2 Expansion Approved"', timestamp: new Date(Date.now() - 2000).toISOString(), category: 'politics' },
  { id: 'act-2', type: 'like', description: 'A user liked a business article from Sudirman', timestamp: new Date(Date.now() - 8000).toISOString(), category: 'business' },
  { id: 'act-3', type: 'share', description: 'Specialty coffee guide shared to social networks', timestamp: new Date(Date.now() - 15000).toISOString(), category: 'lifestyle' },
  { id: 'act-4', type: 'comment', description: 'New comment approved on AFC Badminton victory', timestamp: new Date(Date.now() - 24000).toISOString(), category: 'sports' },
  { id: 'act-5', type: 'reaction', description: 'Reader reacted with "Love" on a World Summit story', timestamp: new Date(Date.now() - 31000).toISOString(), category: 'world' },
];

// Lazily retrieve Gemini Client safely
let aiClient: GoogleGenAI | null = null;
function getAI() {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (key && key !== 'MY_GEMINI_API_KEY' && key.trim() !== '') {
      aiClient = new GoogleGenAI({
        apiKey: key,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build'
          }
        }
      });
    }
  }
  return aiClient;
}

// Background simulation ticker for real-time live metrics
setInterval(() => {
  // Wandering active visitor count +/- 12
  const shift = Math.floor(Math.random() * 25) - 12;
  activeVisitors = Math.max(12000, activeVisitors + shift);

  // Periodic random view, like or action
  const randNum = Math.random();
  if (randNum > 0.4) {
    // Select random article
    const randArtIdx = Math.floor(Math.random() * articles.length);
    const art = articles[randArtIdx];
    
    if (randNum > 0.8) {
      // Record a like
      art.likes += 1;
      art.trendingScore += 1.5;
      totalLikes += 1;
      
      const newAct = {
        id: `act-sim-${Date.now()}`,
        type: 'like' as const,
        description: `Anonymous liked "${art.title.slice(0, 45)}..."`,
        timestamp: new Date().toISOString(),
        category: art.category
      };
      recentActivityList = [newAct, ...recentActivityList.slice(0, 39)];
    } else if (randNum > 0.7) {
      // Record a share
      art.shares += 1;
      art.trendingScore += 4;
      totalShares += 1;
      
      const newAct = {
        id: `act-sim-${Date.now()}`,
        type: 'share' as const,
        description: `Story shared: "${art.title.slice(0, 45)}..."`,
        timestamp: new Date().toISOString(),
        category: art.category
      };
      recentActivityList = [newAct, ...recentActivityList.slice(0, 39)];
    } else if (randNum > 0.45) {
      // Record a view
      art.views += 1;
      art.trendingScore += 0.05;
      totalViews += 1;
      categoryViews[art.category] = (categoryViews[art.category] || 0) + 1;
    }
  }
}, 4000);

// Enable JSON bodies parsing
app.use(express.json());

// API: Live statistics
app.get('/api/stats', (req, res) => {
  res.json({
    activeVisitors,
    totalViews,
    totalLikes,
    totalShares,
    totalReactions,
    recentActivity: recentActivityList,
    categoryViews
  });
});

// API: Lists Articles (with filtering, searching, categorizing, sorting)
app.get('/api/articles', (req, res) => {
  const { category, tag, isFeatured, isEditorPick, search, sort, page = '1', limit = '10' } = req.query;
  
  let filtered = [...articles];

  if (category) {
    filtered = filtered.filter(a => a.category === category);
  }
  if (tag) {
    filtered = filtered.filter(a => a.tags.some(t => t.toLowerCase() === (tag as string).toLowerCase()));
  }
  if (isFeatured === 'true') {
    filtered = filtered.filter(a => a.isFeatured);
  }
  if (isEditorPick === 'true') {
    filtered = filtered.filter(a => a.isEditorPick);
  }
  if (search) {
    const s = (search as string).toLowerCase();
    filtered = filtered.filter(a => 
      a.title.toLowerCase().includes(s) || 
      a.summary.toLowerCase().includes(s) ||
      a.content.toLowerCase().includes(s)
    );
  }

  // Sort logic
  if (sort === 'trending') {
    filtered.sort((a, b) => b.trendingScore - a.trendingScore);
  } else if (sort === 'popular') {
    filtered.sort((a, b) => b.views - a.views);
  } else {
    // default: recent/newest
    filtered.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  }

  // Pagination
  const p = parseInt(page as string, 10);
  const l = parseInt(limit as string, 10);
  const total = filtered.length;
  const paginated = filtered.slice((p - 1) * l, p * l);

  res.json({
    articles: paginated,
    total,
    page: p,
    limit: l,
    totalPages: Math.ceil(total / l)
  });
});

// API: Single Article information (slug or ID)
app.get('/api/articles/:slug', (req, res) => {
  const { slug } = req.params;
  const art = articles.find(a => a.slug === slug || a.id === slug);
  
  if (!art) {
    return res.status(404).json({ error: 'Article not found' });
  }

  // Increment views
  art.views += 1;
  art.trendingScore += 0.1;
  totalViews += 1;
  if (categoryViews[art.category] !== undefined) {
    categoryViews[art.category] += 1;
  }

  // Add engagement Activity Feed event
  const newViewAct = {
    id: `act-view-${Date.now()}`,
    type: 'view' as const,
    description: `Article viewed: "${art.title.slice(0, 45)}..."`,
    timestamp: new Date().toISOString(),
    category: art.category
  };
  recentActivityList = [newViewAct, ...recentActivityList.slice(0, 39)];

  res.json(art);
});

// API: Trigger Likes, Shares, Bookmarks, and Reactions
app.post('/api/articles/:id/like', (req, res) => {
  const art = articles.find(a => a.id === req.params.id);
  if (!art) return res.status(404).json({ error: 'Article not found' });
  
  art.likes += 1;
  art.trendingScore += 1.5;
  totalLikes += 1;

  const newAct = {
    id: `act-like-${Date.now()}`,
    type: 'like' as const,
    description: `A reader liked "${art.title.slice(0, 45)}..."`,
    timestamp: new Date().toISOString(),
    category: art.category
  };
  recentActivityList = [newAct, ...recentActivityList.slice(0, 39)];

  res.json({ likes: art.likes, trendingScore: art.trendingScore });
});

app.post('/api/articles/:id/share', (req, res) => {
  const art = articles.find(a => a.id === req.params.id);
  if (!art) return res.status(404).json({ error: 'Article not found' });
  
  art.shares += 1;
  art.trendingScore += 4;
  totalShares += 1;

  const newAct = {
    id: `act-share-${Date.now()}`,
    type: 'share' as const,
    description: `Shared to chat networks: "${art.title.slice(0, 45)}..."`,
    timestamp: new Date().toISOString(),
    category: art.category
  };
  recentActivityList = [newAct, ...recentActivityList.slice(0, 39)];

  res.json({ shares: art.shares, trendingScore: art.trendingScore });
});

app.post('/api/articles/:id/bookmark', (req, res) => {
  const art = articles.find(a => a.id === req.params.id);
  if (!art) return res.status(404).json({ error: 'Article not found' });
  
  art.bookmarksCount += 1;
  art.trendingScore += 1.0;

  res.json({ bookmarksCount: art.bookmarksCount, trendingScore: art.trendingScore });
});

app.post('/api/articles/:id/react', (req, res) => {
  const { reaction } = req.body as { reaction: 'like' | 'love' | 'wow' | 'sad' | 'angry' };
  const art = articles.find(a => a.id === req.params.id);
  if (!art) return res.status(404).json({ error: 'Article not found' });
  if (!reaction || !['like', 'love', 'wow', 'sad', 'angry'].includes(reaction)) {
    return res.status(400).json({ error: 'Invalid reaction type' });
  }

  art.reactions[reaction] = (art.reactions[reaction] || 0) + 1;
  totalReactions += 1;
  art.trendingScore += 1.2;

  const labels = { like: 'Like', love: 'Love ❤️', wow: 'Wow 😮', sad: 'Sad 😢', angry: 'Angry 😡' };
  const newAct = {
    id: `act-react-${Date.now()}`,
    type: 'reaction' as const,
    description: `Reacted with "${labels[reaction] || reaction}" on "${art.title.slice(0, 40)}..."`,
    timestamp: new Date().toISOString(),
    category: art.category
  };
  recentActivityList = [newAct, ...recentActivityList.slice(0, 39)];

  res.json({ reactions: art.reactions, trendingScore: art.trendingScore });
});

// API: Comments for Article
app.get('/api/articles/:id/comments', (req, res) => {
  const approvedComments = comments.filter(c => c.articleId === req.params.id && c.status === 'approved');
  // Sort approved comments by date (newest first)
  approvedComments.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  res.json(approvedComments);
});

// API: Add Comment (with simulated real-time approvals)
app.post('/api/articles/:id/comments', (req, res) => {
  const { authorName, authorEmail, content } = req.body;
  if (!authorName || !content) {
    return res.status(400).json({ error: 'Author name and content are required' });
  }

  const art = articles.find(a => a.id === req.params.id);
  if (!art) return res.status(404).json({ error: 'Article not found' });

  const newComment: Comment = {
    id: `comm-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    articleId: req.params.id,
    authorName,
    authorEmail: authorEmail || 'anonymous@guest.com',
    content,
    timestamp: new Date().toISOString(),
    status: 'approved', // auto approved for instant social feel, editable in admin panel
    likes: 0
  };

  comments.push(newComment);
  art.trendingScore += 3.0;

  const newAct = {
    id: `act-comment-${Date.now()}`,
    type: 'comment' as const,
    description: `${authorName} commented on "${art.title.slice(0, 45)}..."`,
    timestamp: new Date().toISOString(),
    category: art.category
  };
  recentActivityList = [newAct, ...recentActivityList.slice(0, 39)];

  res.json(newComment);
});

// API: List Authors
app.get('/api/authors', (req, res) => {
  res.json(authors);
});

// API: INTERACTIVE AI-REPORTER (Gemini Powered)
app.post('/api/articles/:id/ask-ai', async (req, res) => {
  const { question } = req.body;
  if (!question || question.trim() === '') {
    return res.status(400).json({ error: 'Question is empty' });
  }

  const art = articles.find(a => a.id === req.params.id);
  if (!art) return res.status(404).json({ error: 'Article not found' });

  const author = AUTHORS.find(au => au.id === art.authorId) || AUTHORS[0];

  const ai = getAI();
  if (!ai) {
    // Beautiful mock reporter fallback if Gemini API key is missing
    return res.json({
      answer: `Hello! I am ${author.name}, the author of this story. (Note: Gemini API key is not currently activated in AI Studio, but here is my editorial response based on the report data):

Regarding your query: "${question}" — as reported in this piece, we are tracking details closely. This development impacts key infrastructure and SME portfolios around metropolitan Jakarta. We anticipate subsequent announcements by regional boards to address these concerns early next quarter. Is there anything specific from my field research you would like to ask next?`,
      source: 'Local Editorial Database Fallback'
    });
  }

  try {
    const prompt = `You are playing the role of ${author.name}, whose bio is: "${author.bio}". 
You are the journalist who wrote this article:
Title: "${art.title}"
Summary: "${art.summary}"
Content:
"""
${art.content}
"""

A reader of "The Daily Jakarta" is asking you this question in the comment section:
"${question}"

Provide a professional, direct, in-character explanation as the journalist who did the investigation. Keep it within 120-180 words, maintain high journalistic authority, and sign off with your name (${author.name}). Present the answer directly as text.`;

    const result = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
    });

    res.json({
      answer: result.text || 'I apologize, I was unable to compile a response at this moment.',
      source: 'Gemini 3.5'
    });
  } catch (err: any) {
    res.json({
      answer: `Hello! I am ${author.name}. I received your question about my article. It appears our remote transmission networks are experiencing heavy traffic (Developer info: ${err.message || 'Gemini error'}), but I can share that we are following the regulatory aspects closely!`,
      source: 'Local Error Recovery Fallback'
    });
  }
});

// ADMIN API: Create, Update, Delete Articles
app.post('/api/admin/articles', (req, res) => {
  const { title, summary, content, category, tags, featuredImage, authorId, isFeatured, isEditorPick, readingTime } = req.body;
  
  if (!title || !content || !category || !authorId) {
    return res.status(400).json({ error: 'Title, content, category, and authorId are required.' });
  }

  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now().toString().slice(-4);
  const newArt: Article = {
    id: `art-admin-${Date.now()}`,
    slug,
    title,
    summary: summary || title.slice(0, 100) + '...',
    content,
    category: category as Category,
    tags: tags || [category.toUpperCase()],
    featuredImage: featuredImage || 'https://images.unsplash.com/photo-1540910419892-4a36d2c3266c?w=600&auto=format&fit=crop&q=80',
    authorId,
    publishedAt: new Date().toISOString(),
    readingTime: parseInt(readingTime || '5', 10),
    isFeatured: isFeatured === true || isFeatured === 'true',
    isEditorPick: isEditorPick === true || isEditorPick === 'true',
    views: 0,
    likes: 0,
    shares: 0,
    bookmarksCount: 0,
    trendingScore: 10, // baseline for new entries
    reactions: { like: 0, love: 0, wow: 0, sad: 0, angry: 0 }
  };

  articles.unshift(newArt); // Prepend to lists
  res.status(201).json(newArt);
});

app.put('/api/admin/articles/:id', (req, res) => {
  const index = articles.findIndex(a => a.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Article not found' });

  const current = articles[index];
  const { title, summary, content, category, tags, featuredImage, authorId, isFeatured, isEditorPick, readingTime } = req.body;

  let updatedSlug = current.slug;
  if (title && title !== current.title) {
    updatedSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now().toString().slice(-4);
  }

  const updated: Article = {
    ...current,
    slug: updatedSlug,
    title: title ?? current.title,
    summary: summary ?? current.summary,
    content: content ?? current.content,
    category: (category ?? current.category) as Category,
    tags: tags ?? current.tags,
    featuredImage: featuredImage ?? current.featuredImage,
    authorId: authorId ?? current.authorId,
    readingTime: readingTime ? parseInt(readingTime, 10) : current.readingTime,
    isFeatured: isFeatured !== undefined ? (isFeatured === true || isFeatured === 'true') : current.isFeatured,
    isEditorPick: isEditorPick !== undefined ? (isEditorPick === true || isEditorPick === 'true') : current.isEditorPick,
  };

  articles[index] = updated;
  res.json(updated);
});

app.delete('/api/admin/articles/:id', (req, res) => {
  const index = articles.findIndex(a => a.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Article not found' });
  
  const deleted = articles.splice(index, 1);
  res.json({ message: 'Article deleted successfully', deleted });
});

// ADMIN API: Modern AI content assistant to draft stories dynamically
app.post('/api/admin/articles/generate', async (req, res) => {
  const { topic, category, authorId } = req.body;
  if (!topic || !category) {
    return res.status(400).json({ error: 'Topic and Category are required.' });
  }

  const selectedAuthor = AUTHORS.find(au => au.id === authorId) || AUTHORS[0];
  const ai = getAI();
  
  if (!ai) {
    // Beautiful mock generated response if Gemini is not currently active
    const cleanTopic = topic.trim();
    return res.json({
      title: `Analysis: Emerging Shifting Frameworks on "${cleanTopic}"`,
      summary: `Our latest metropolitan analysis examines the shifting dynamics surrounding "${cleanTopic}" and its long-term impacts on Southeast Asia's fastest-growing business districts.`,
      content: `### Groundwork Overview
The recent debates surrounding "${cleanTopic}" have officially entered active regulatory reviews. Across key boardrooms in Sudirman and central ministries in Menteng, stakeholders are outlining major frameworks to sustain long-term operations while balancing communal welfare.

According to regional planners, aligning existing transport, enterprise, and ecological systems with these challenges is no longer an optional milestone, but an absolute necessity.

### The Macro Impact
1. **Economic Spillovers**: Local businesses stand to benefit from a highly integrated structure.
2. **Citizen Integration**: Public portals must incorporate high-contrast screens and instant accessibility widgets to capture community feedback.
3. **Regulatory Alignments**: Future bills will mandate higher standards of transparency.

"We are entering an era of meticulous metropolitan development," marked field correspondents doing studies on regional investments. We will report live as secondary files and legislative briefs become available.`,
      tags: [category.toUpperCase(), 'AI_DRAFT', 'JAKARTA_REPORTS'],
      readingTime: 4
    });
  }

  try {
    const prompt = `Write a high-quality news article for "The Daily Jakarta" based on this topic: "${topic}".
Category of the news: "${category}".
Written by reporter: "${selectedAuthor.name}" (${selectedAuthor.role}).

Generate the output in strict JSON format matching variables:
{
  "title": "A highly catchy, editorial corporate title in Georgia font style",
  "summary": "A 2 to 3 sentence sleek subheader summarizing the story",
  "content": "Fully-realized journalistic article in markdown format with headings (using ###), quotes, and structural pointers. Should be 300 to 450 words in length.",
  "tags": ["Tag1", "Tag2", "Tag3"],
  "readingTime": 5
}
Ensure the content is detailed, highly realistic, professional, and includes references to Jakarta context (like Sudirman, Menteng, local authorities, or cultural elements). Use double quotes inside JSON safely.`;

    const result = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json'
      }
    });

    const draft = JSON.parse(result.text || '{}');
    res.json(draft);
  } catch (err: any) {
    res.status(500).json({ error: `Gemini generation failed: ${err.message}` });
  }
});

// ADMIN API: Moderate and Modulate Reader Comments
app.get('/api/admin/comments', (req, res) => {
  const { status } = req.query;
  let list = [...comments];
  if (status) {
    list = list.filter(c => c.status === status);
  }
  // Include corresponding article titles for visual context in panel
  const commentsWithArticleInfo = list.map(c => {
    const art = articles.find(a => a.id === c.articleId);
    return {
      ...c,
      articleTitle: art ? art.title : 'Deleted Article/Unknown'
    };
  });
  // Newest first
  commentsWithArticleInfo.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  res.json(commentsWithArticleInfo);
});

app.post('/api/admin/comments/:id/moderate', (req, res) => {
  const { status } = req.body;
  if (!status || !['pending', 'approved', 'rejected', 'spam'].includes(status)) {
    return res.status(400).json({ error: 'Invalid moderation status.' });
  }

  const index = comments.findIndex(c => c.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Comment not found.' });

  comments[index].status = status as 'pending' | 'approved' | 'rejected' | 'spam';
  res.json(comments[index]);
});

// ADMIN API: Analytics summaries
app.get('/api/admin/analytics', (req, res) => {
  // Aggregate category stats
  const aggCategory = Object.entries(categoryViews).map(([cat, views]) => ({
    category: cat,
    views
  }));

  // Most active commentators ranking
  const commentatorCounts: Record<string, number> = {};
  comments.forEach(c => {
    commentatorCounts[c.authorName] = (commentatorCounts[c.authorName] || 0) + 1;
  });
  const topCommentators = Object.entries(commentatorCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Top articles by engagement
  const topArticles = [...articles]
    .sort((a, b) => b.views - a.views)
    .slice(0, 5)
    .map(a => ({
      id: a.id,
      title: a.title,
      views: a.views,
      likes: a.likes,
      shares: a.shares,
      category: a.category
    }));

  res.json({
    aggCategory,
    topCommentators,
    topArticles,
    totalRegisteredArticles: articles.length,
    totalStoredComments: comments.length
  });
});

// SEO SITEMAP & METADATA XML
app.get('/sitemap.xml', (req, res) => {
  res.header('Content-Type', 'application/xml');
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
  
  // Add static urls
  xml += `  <url>\n    <loc>${process.env.APP_URL || 'https://thedailyjakarta.com'}/</loc>\n    <changefreq>always</changefreq>\n    <priority>1.0</priority>\n  </url>\n`;
  xml += `  <url>\n    <loc>${process.env.APP_URL || 'https://thedailyjakarta.com'}/dashboard</loc>\n    <changefreq>hourly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
  
  // Add article urls
  articles.forEach(art => {
    xml += `  <url>\n    <loc>${process.env.APP_URL || 'https://thedailyjakarta.com'}/article/${art.slug}</loc>\n    <lastmod>${art.publishedAt.split('T')[0]}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>\n`;
  });

  xml += `</urlset>`;
  res.send(xml);
});

// Serve Frontend Vite SPA Middleware programmatically
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
  // Serve built static assets from dist/ folder
  const distPath = path.resolve(process.cwd(), 'dist');
  app.use(express.static(distPath));

  app.get('*', (req, res, next) => {
    // If request has '/api/', let it bypass static routing
    if (req.path.startsWith('/api') || req.path === '/sitemap.xml') {
      return next();
    }
    res.sendFile(path.resolve(distPath, 'index.html'));
  });
} else {
  // Load Vite Dev Server in middleware mode
  import('vite').then(({ createServer: createViteServer }) => {
    createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    }).then((vite) => {
      app.use(vite.middlewares);
    });
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`The Daily Jakarta custom Node server running on http://localhost:${PORT}`);
});
