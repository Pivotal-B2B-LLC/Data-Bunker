/**
 * Enhanced AI Assistant Service
 * Intelligent conversational assistant with app control and advanced capabilities
 */

const companiesHouse = require('./companiesHouse');
const openCorporates = require('./openCorporates');
const googlePlaces = require('./googlePlacesService');
const webScraper = require('./webScraperService');
const ollama = require('./ollamaService');

class EnhancedAIAssistant {
  constructor() {
    this.conversations = new Map(); // Store conversation context per session
    this.userPreferences = new Map(); // Store user preferences and settings
    this.capabilities = [
      'search companies globally',
      'get detailed company information',
      'find contact details (email, phone, website)',
      'scrape company websites',
      'filter companies by location',
      'compare multiple companies',
      'explain concepts and answer questions',
      'provide ideas and suggestions',
      'natural conversation understanding',
      'remember your preferences',
      'control app navigation'
    ];
  }

  /**
   * Process user message with full context awareness
   */
  async processMessage(message, sessionId = 'default', appContext = {}) {
    try {
      console.log('[AI Assistant] Message:', message);

      // Get conversation history
      const history = this._getHistory(sessionId);
      history.push({ role: 'user', content: message, timestamp: Date.now() });

      // Detect intent with context
      const intent = this._analyzeIntent(message, history, appContext);
      console.log('[AI Assistant] Intent:', intent.type, intent.confidence);

      // Route to appropriate handler
      const response = await this._routeIntent(intent, history, appContext, sessionId);

      // Add to history
      history.push({ role: 'assistant', content: response.message, timestamp: Date.now(), data: response.data });

      // Cleanup old history
      if (history.length > 30) history.splice(0, history.length - 30);

      return response;
    } catch (error) {
      console.error('[AI Assistant] Error:', error);
      return this._createErrorResponse(error);
    }
  }

  /**
   * Advanced intent analysis with confidence scoring
   */
  _analyzeIntent(message, history, context) {
    const msg = message.toLowerCase();
    const patterns = {
      search_company: [
        /search (?:for )?(.+)/i,
        /find (?:companies? )?(?:called )?(.+)/i,
        /look (?:for|up) (.+)/i,
        /show me (.+) (?:company|companies|firm)/i,
        /tell me about (.+) (?:company|ltd|inc)/i,
        /(?:info|information) (?:on|about) (.+) (?:company|ltd)/i
      ],
      get_contacts: [
        /contact (?:info|details|information)/i,
        /(?:email|phone|website) (?:for|of) (.+)/i,
        /how (?:can i|to) contact (.+)/i,
        /reach out to (.+)/i
      ],
      scrape_website: [
        /scrape (.+)/i,
        /crawl (.+) website/i,
        /extract (?:data|info) from (.+)/i,
        /get website (?:data|info) (?:for|from) (.+)/i
      ],
      filter_location: [
        /(?:show|find|list) (?:companies in|from) (.+)/i,
        /companies (?:located )?(?:in|at) (.+)/i,
        /(?:filter by|in|from) location (.+)/i
      ],
      company_details: [
        /details (?:for|of|about) (.+)/i,
        /more (?:info|information) (?:on|about) (.+)/i,
        /full details (.+)/i
      ],
      compare_companies: [
        /compare (.+) (?:and|with|vs) (.+)/i,
        /difference between (.+) and (.+)/i,
        /(.+) vs (.+)/i
      ],
      set_preference: [
        /remember (.+)/i,
        /set (?:preference|setting) (.+)/i,
        /i prefer (.+)/i,
        /always (.+)/i
      ],
      greeting: [
        /^(hi|hello|hey|greetings|good (?:morning|afternoon|evening))/i,
        /^what's up/i,
        /^how are you/i
      ],
      help: [
        /help/i,
        /what can you do/i,
        /capabilities/i,
        /show me what/i
      ],
      explanation: [
        /what (?:is|are|does) (.+)/i,
        /explain (.+)/i,
        /tell me about (.+)/i,
        /how (?:does|do) (.+) work/i,
        /why (.+)/i,
        /can you (?:explain|tell me) (.+)/i
      ],
      suggestion_request: [
        /(?:give me|suggest|recommend) (?:some )?(?:ideas|suggestions)/i,
        /what (?:should|can) i (?:search|do|look)/i,
        /any (?:ideas|suggestions)/i,
        /help me find/i
      ]
    };

    // Match patterns
    for (const [intentType, patternList] of Object.entries(patterns)) {
      for (const pattern of patternList) {
        const match = message.match(pattern);
        if (match) {
          return {
            type: intentType,
            params: this._extractParams(match, intentType),
            confidence: 0.9,
            raw: message
          };
        }
      }
    }

    // Contextual intent detection
    if (history.length > 0) {
      const lastIntent = history[history.length - 1];
      if (lastIntent.role === 'assistant' && lastIntent.awaitingInput) {
        return {
          type: 'continue_context',
          params: { input: message, previousContext: lastIntent },
          confidence: 0.8,
          raw: message
        };
      }
    }

    // If no specific pattern matches, treat as conversational query
    return { type: 'conversational', params: { query: message }, confidence: 0.7, raw: message };
  }

  /**
   * Extract parameters from matched intent
   */
  _extractParams(match, intentType) {
    const params = {};
    
    if (match[1]) params.query = match[1].trim();
    if (match[2]) params.query2 = match[2].trim();

    // Extract location codes
    const locationPatterns = {
      'uk': 'gb', 'united kingdom': 'gb', 'britain': 'gb',
      'usa': 'us', 'united states': 'us', 'america': 'us',
      'france': 'fr', 'germany': 'de', 'spain': 'es',
      'india': 'in', 'china': 'cn', 'japan': 'jp'
    };

    const msg = match.input.toLowerCase();
    for (const [name, code] of Object.entries(locationPatterns)) {
      if (msg.includes(name)) {
        params.country = code;
        params.location = name;
        break;
      }
    }

    return params;
  }

  /**
   * Route intent to appropriate handler
   */
  async _routeIntent(intent, history, context, sessionId) {
    const handlers = {
      search_company: () => this._searchCompany(intent, context),
      get_contacts: () => this._getContacts(intent, context),
      scrape_website: () => this._scrapeWebsite(intent, context),
      filter_location: () => this._filterLocation(intent, context),
      company_details: () => this._getCompanyDetails(intent, context),
      compare_companies: () => this._compareCompanies(intent, context),
      set_preference: () => this._setPreference(intent, sessionId),
      greeting: () => this._handleGreeting(intent, history),
      help: () => this._showHelp(),
      explanation: async () => this._explainConcept(intent, history),
      suggestion_request: () => this._provideSuggestions(intent, context),
      conversational: () => this._handleConversation(intent, history)
    };

    const handler = handlers[intent.type];
    return handler ? await handler() : this._createDefaultResponse();
  }

  /**
   * Search for companies
   */
  async _searchCompany(intent, context) {
    const { query, country, location } = intent.params;

    if (!query) {
      return {
        message: "Sure! What company would you like me to search for?",
        type: 'awaiting_input',
        awaitingInput: true,
        suggestions: ["Tesla", "Apple Inc", "Google", "Microsoft"]
      };
    }

    try {
      let results = { companies: [] };

      if (country === 'gb') {
        console.log('[AI] Searching UK Companies House for:', query);
        results = await companiesHouse.searchCompanies(query, { limit: 10 });
      } else if (country) {
        console.log('[AI] Searching OpenCorporates for:', query);
        results = await openCorporates.searchCompanies(query, { country, limit: 10 });
      } else {
        // Try both
        console.log('[AI] Searching global databases for:', query);
        const [ukResults, globalResults] = await Promise.allSettled([
          companiesHouse.searchCompanies(query, { limit: 5 }),
          openCorporates.searchCompanies(query, { limit: 5 })
        ]);
        
        const allCompanies = [];
        if (ukResults.status === 'fulfilled') allCompanies.push(...ukResults.value.companies);
        if (globalResults.status === 'fulfilled') allCompanies.push(...globalResults.value.companies);
        
        results = { companies: allCompanies, total: allCompanies.length };
      }

      if (results.companies.length === 0) {
        return {
          message: `I couldn't find any companies matching "${query}"${location ? ` in ${location}` : ''}. Try a different search term or location.`,
          type: 'search_result',
          data: { companies: [], query },
          suggestions: ["Try a different spelling", "Search globally", "Try another company"]
        };
      }

      const topResults = results.companies.slice(0, 5);
      const message = `I found ${results.total || results.companies.length} companies matching "${query}"${location ? ` in ${location}` : ''}! Here are the top results:\n\n` +
        topResults.map((c, i) => `${i + 1}. **${c.name}** (${c.registrationNumber}) - ${c.status}`).join('\n') +
        `\n\nWould you like me to get contact details or full information for any of these?`;

      return {
        message,
        type: 'search_result',
        data: { companies: topResults, total: results.total, query },
        suggestions: [
          `Get details for ${topResults[0].name}`,
          `Contact info for ${topResults[0].name}`,
          "Show me more results"
        ],
        action: {
          type: 'display_companies',
          payload: topResults
        }
      };
    } catch (error) {
      console.error('[AI] Search error:', error);
      return {
        message: `I ran into an issue searching for "${query}". ${error.message}`,
        type: 'error',
        suggestions: ["Try again", "Search another company", "Get help"]
      };
    }
  }

  /**
   * Get contact information
   */
  async _getContacts(intent, context) {
    const { query } = intent.params;

    if (!query) {
      return {
        message: "Which company's contact information would you like?",
        type: 'awaiting_input',
        awaitingInput: true
      };
    }

    try {
      console.log('[AI] Getting contact info for:', query);
      
      // Search for the company first
      const searchResults = await companiesHouse.searchCompanies(query, { limit: 1 });
      
      if (!searchResults.companies || searchResults.companies.length === 0) {
        return {
          message: `I couldn't find "${query}". Could you be more specific?`,
          type: 'not_found'
        };
      }

      const company = searchResults.companies[0];
      
      // Enrich with Google Places
      const enriched = await googlePlaces.enrichCompanyData(company);
      
      // Scrape website if available
      let scrapedData = {};
      if (enriched.website) {
        try {
          scrapedData = await webScraper.scrapeCompanyWebsite(enriched.website);
        } catch (e) {
          console.log('[AI] Website scraping failed:', e.message);
        }
      }

      const contacts = {
        emails: [...(enriched.emails || []), ...(scrapedData.emails || [])],
        phones: [...(enriched.phones || []), ...(scrapedData.phones || [])],
        website: enriched.website || scrapedData.website,
        social: scrapedData.socialMedia || {}
      };

      let message = `Here's the contact information I found for **${company.name}**:\n\n`;
      
      if (contacts.website) message += `🌐 **Website:** ${contacts.website}\n`;
      if (contacts.emails.length) message += `📧 **Emails:** ${contacts.emails.join(', ')}\n`;
      if (contacts.phones.length) message += `📞 **Phones:** ${contacts.phones.join(', ')}\n`;
      if (contacts.social.linkedin) message += `💼 **LinkedIn:** ${contacts.social.linkedin}\n`;
      if (contacts.social.twitter) message += `🐦 **Twitter:** ${contacts.social.twitter}\n`;
      
      if (!contacts.website && !contacts.emails.length && !contacts.phones.length) {
        message = `I found **${company.name}**, but couldn't locate public contact information. Would you like me to search their website or try another source?`;
      }

      return {
        message,
        type: 'contact_info',
        data: { company, contacts },
        suggestions: ["Scrape their website", "Search another company", "Get more details"]
      };
    } catch (error) {
      return {
        message: `Sorry, I had trouble getting contact info: ${error.message}`,
        type: 'error'
      };
    }
  }

  /**
   * Scrape company website
   */
  async _scrapeWebsite(intent, context) {
    const { query } = intent.params;

    if (!query) {
      return {
        message: "Which company's website should I scrape?",
        type: 'awaiting_input',
        awaitingInput: true
      };
    }

    try {
      // Check if query is a URL
      const isUrl = query.startsWith('http://') || query.startsWith('https://') || query.includes('.');
      
      let url = query;
      if (!isUrl) {
        // Search for company and get website
        const results = await webScraper.searchCompanyOnGoogle(query);
        if (results.length === 0) {
          return {
            message: `I couldn't find a website for "${query}". Could you provide the URL?`,
            type: 'not_found'
          };
        }
        url = results[0].link;
      }

      console.log('[AI] Scraping:', url);
      const scrapedData = await webScraper.scrapeCompanyWebsite(url);

      let message = `I've scraped **${url}** and found:\n\n`;
      message += `📧 **${scrapedData.emails.length} Email(s):** ${scrapedData.emails.join(', ') || 'None'}\n`;
      message += `📞 **${scrapedData.phones.length} Phone(s):** ${scrapedData.phones.join(', ') || 'None'}\n`;
      message += `🔗 **Social Media:**\n`;
      
      const social = scrapedData.socialMedia;
      if (social.linkedin) message += `  - LinkedIn: ${social.linkedin}\n`;
      if (social.twitter) message += `  - Twitter: ${social.twitter}\n`;
      if (social.facebook) message += `  - Facebook: ${social.facebook}\n`;
      
      if (Object.keys(social).length === 0) message += `  None found\n`;

      return {
        message,
        type: 'scrape_result',
        data: scrapedData,
        suggestions: ["Search another company", "Get company details", "Help"]
      };
    } catch (error) {
      return {
        message: `I had trouble scraping that website: ${error.message}`,
        type: 'error'
      };
    }
  }

  /**
   * Filter companies by location
   */
  async _filterLocation(intent, context) {
    const { location, country } = intent.params;

    return {
      message: `I'll help you find companies in **${location || country}**. Let me update the location filter for you.`,
      type: 'filter_location',
      action: {
        type: 'set_location_filter',
        payload: { country, location }
      },
      suggestions: ["Show results", "Refine by city", "Search specific company"]
    };
  }

  /**
   * Get detailed company information
   */
  async _getCompanyDetails(intent, context) {
    const { query } = intent.params;

    try {
      const results = await companiesHouse.searchCompanies(query, { limit: 1 });
      
      if (!results.companies || results.companies.length === 0) {
        return {
          message: `I couldn't find "${query}". Try being more specific.`,
          type: 'not_found'
        };
      }

      const company = results.companies[0];
      const details = await companiesHouse.getCompanyDetails(company.registrationNumber);
      const officers = await companiesHouse.getCompanyOfficers(company.registrationNumber);

      let message = `📊 **Detailed Information for ${details.name}**\n\n`;
      message += `📋 **Registration Number:** ${details.registrationNumber}\n`;
      message += `📍 **Status:** ${details.status}\n`;
      message += `📅 **Incorporated:** ${details.incorporationDate || 'N/A'}\n`;
      message += `🏢 **Type:** ${details.type || 'N/A'}\n`;
      message += `📫 **Address:** ${details.address || 'N/A'}\n`;
      
      if (officers && officers.length > 0) {
        message += `\n👥 **Officers:** ${officers.slice(0, 3).map(o => o.name).join(', ')}`;
        if (officers.length > 3) message += ` and ${officers.length - 3} more`;
      }

      return {
        message,
        type: 'company_details',
        data: { ...details, officers },
        suggestions: ["Get contact info", "Scrape website", "Search another company"]
      };
    } catch (error) {
      return {
        message: `Error getting company details: ${error.message}`,
        type: 'error'
      };
    }
  }

  /**
   * Compare companies
   */
  async _compareCompanies(intent, context) {
    const { query, query2 } = intent.params;

    if (!query || !query2) {
      return {
        message: "Please specify two companies to compare. Example: 'Compare Google and Microsoft'",
        type: 'awaiting_input'
      };
    }

    try {
      const [company1Data, company2Data] = await Promise.all([
        companiesHouse.searchCompanies(query, { limit: 1 }),
        companiesHouse.searchCompanies(query2, { limit: 1 })
      ]);

      const c1 = company1Data.companies[0];
      const c2 = company2Data.companies[0];

      if (!c1 || !c2) {
        return {
          message: "I couldn't find one or both companies. Please check the names and try again.",
          type: 'not_found'
        };
      }

      let message = `📊 **Comparison: ${c1.name} vs ${c2.name}**\n\n`;
      message += `**${c1.name}**\n`;
      message += `  - Status: ${c1.status}\n`;
      message += `  - Reg: ${c1.registrationNumber}\n`;
      message += `  - Type: ${c1.type || 'N/A'}\n\n`;
      
      message += `**${c2.name}**\n`;
      message += `  - Status: ${c2.status}\n`;
      message += `  - Reg: ${c2.registrationNumber}\n`;
      message += `  - Type: ${c2.type || 'N/A'}\n`;

      return {
        message,
        type: 'comparison',
        data: { company1: c1, company2: c2 },
        suggestions: ["Get details for both", "Contact info comparison", "Search others"]
      };
    } catch (error) {
      return {
        message: `Error comparing companies: ${error.message}`,
        type: 'error'
      };
    }
  }

  /**
   * Set user preference
   */
  _setPreference(intent, sessionId) {
    const { query } = intent.params;
    
    if (!this.userPreferences.has(sessionId)) {
      this.userPreferences.set(sessionId, {});
    }
    
    const prefs = this.userPreferences.get(sessionId);
    
    // Parse preference from query
    if (query.includes('country') || query.includes('location')) {
      const country = this._extractParams({ input: query }, 'location').country;
      if (country) {
        prefs.defaultCountry = country;
        return {
          message: `Got it! I'll remember to search in ${country.toUpperCase()} by default.`,
          type: 'preference_set',
          data: { preference: 'defaultCountry', value: country }
        };
      }
    }

    return {
      message: `I've noted your preference. What would you like me to remember?`,
      type: 'preference_set'
    };
  }

  /**
   * Handle greetings
   */
  _handleGreeting(intent, history) {
    const greetings = [
      "Hello! I'm your AI assistant. I can help you find and research companies worldwide. What can I do for you?",
      "Hi there! Ready to search for companies? Just tell me what you need!",
      "Hey! I'm here to help you discover company information. What would you like to know?",
      "Greetings! I can search companies, find contact info, and scrape websites. How can I assist you today?"
    ];

    return {
      message: greetings[Math.floor(Math.random() * greetings.length)],
      type: 'greeting',
      suggestions: [
        "Search for Tesla",
        "Find companies in London",
        "What can you do?",
        "Get contact info for Apple"
      ]
    };
  }

  /**
   * Show help and capabilities
   */
  _showHelp() {
    const message = `🤖 **I'm your intelligent AI assistant!** Here's everything I can do:\n\n` +
      `**🔍 SEARCH & RESEARCH**\n` +
      `• "Find Tesla" or "Search for Google in UK"\n` +
      `• "Show companies in London"\n` +
      `• "Details for Amazon"\n` +
      `• "Compare Google and Microsoft"\n\n` +
      `**📞 CONTACT INFORMATION**\n` +
      `• "Contact info for Apple"\n` +
      `• "Email for Microsoft"\n` +
      `• "Get phone number for Shell"\n\n` +
      `**🌐 WEB SCRAPING**\n` +
      `• "Scrape tesla.com"\n` +
      `• "Extract data from website"\n` +
      `• "Get contact info from www.example.com"\n\n` +
      `**💡 SMART FEATURES**\n` +
      `• "What is scraping?" - I can explain concepts\n` +
      `• "Give me ideas" - Get suggestions\n` +
      `• "Remember I prefer UK companies" - Save preferences\n` +
      `• Natural conversation - Just talk to me!\n\n` +
      `**🎯 APP CONTROL**\n` +
      `• I can navigate and control the app\n` +
      `• Set location filters automatically\n` +
      `• Display results and company cards\n\n` +
      `I understand context and remember our conversation. Ask me anything! 🚀`;

    return {
      message,
      type: 'help',
      data: { capabilities: this.capabilities },
      suggestions: [
        "Search for Tesla",
        "What is scraping?",
        "Give me ideas",
        "Companies in London"
      ]
    };
  }

  /**
   * Handle general queries — powered by Llama 3.2 if available
   */
  async _handleGeneralQuery(intent, history) {
    try {
      const llmAvailable = await ollama.isAvailable();
      if (llmAvailable) {
        const answer = await ollama.answerQuestion(intent.raw || intent.params?.query || '');
        if (answer) {
          return {
            message: answer,
            type: 'general',
            suggestions: ['Search for a company', 'What can you do?', 'Give me ideas'],
          };
        }
      }
    } catch (err) {
      console.warn('[AI Assistant] Ollama unavailable for general query:', err.message);
    }

    const responses = [
      "I'm not quite sure what you're asking. Could you rephrase that? Try asking me to search for a company or type 'help' to see what I can do.",
      "Hmm, I didn't catch that. I can help you find companies, get contact info, or scrape websites. What would you like to do?",
      "I'm here to help with company research! Try asking me to search for a company or find contact information.",
    ];
    return {
      message: responses[Math.floor(Math.random() * responses.length)],
      type: 'general',
      suggestions: ['Help', 'Search for Tesla', 'What can you do?'],
    };
  }

  /**
   * Explain concepts and answer "what is" questions
   */
  async _explainConcept(intent, history) {
    const { query } = intent.params;
    const concept = query ? query.toLowerCase().trim() : '';

    const explanations = {
      'scrape': {
        title: 'Web Scraping',
        explanation: `**Web scraping** is the process of automatically extracting data from websites. When I scrape a company website, I:\n\n` +
          `🔍 Analyze the HTML structure\n` +
          `📧 Extract email addresses and contact information\n` +
          `📞 Find phone numbers and social media links\n` +
          `🌐 Collect website URLs and metadata\n\n` +
          `For example, if you ask me to "scrape tesla.com", I'll visit the website and extract all available contact information for you!`,
        examples: ["Scrape www.apple.com", "Extract data from microsoft.com", "Get contact info from a website"]
      },
      'scraping': { redirect: 'scrape' },
      'opencorporates': {
        title: 'OpenCorporates',
        explanation: `**OpenCorporates** is the world's largest open database of companies, with data on over 200 million companies from 140+ jurisdictions worldwide.\n\n` +
          `I use it to search for companies globally when you're looking for businesses outside the UK. It provides:\n` +
          `• Company registration numbers\n` +
          `• Incorporation dates\n` +
          `• Company status\n` +
          `• Registered addresses\n` +
          `• Officer information`,
        examples: ["Search for companies in Germany", "Find Apple Inc details"]
      },
      'companies house': {
        title: 'Companies House',
        explanation: `**Companies House** is the UK's official registrar of companies. It maintains the register of UK companies and makes company information publicly available.\n\n` +
          `I use it to search for UK companies and provide:\n` +
          `• Company registration details\n` +
          `• Directors and officers\n` +
          `• Financial filings\n` +
          `• Company status and history`,
        examples: ["Search for Tesco", "Find UK companies in London"]
      },
      'api': {
        title: 'API (Application Programming Interface)',
        explanation: `An **API** is a way for different software applications to communicate with each other. I use APIs from Companies House, OpenCorporates, and Google Places to fetch company data for you automatically.\n\n` +
          `Think of it like a waiter in a restaurant - you (the user) tell me what you want, I use the API to request it from the "kitchen" (external services), and deliver the results back to you!`,
        examples: ["Search for a company", "Get company details"]
      },
      'contact info': {
        title: 'Contact Information',
        explanation: `**Contact information** includes ways to reach a company:\n` +
          `📧 Email addresses\n` +
          `📞 Phone numbers\n` +
          `🌐 Website URLs\n` +
          `💼 Social media profiles (LinkedIn, Twitter, Facebook)\n\n` +
          `I gather this information from multiple sources including Google Places API and by scraping company websites.`,
        examples: ["Get contact info for Apple", "Find email for Microsoft"]
      },
      'location filter': {
        title: 'Location Filtering',
        explanation: `**Location filtering** helps you find companies in specific geographic areas. You can filter by:\n` +
          `🌍 Country\n` +
          `🏙️ State/Region\n` +
          `📍 City\n` +
          `🏘️ District\n\n` +
          `I'll automatically search and filter results to show only companies registered in your selected location!`,
        examples: ["Show companies in London", "Find firms in New York", "Filter by California"]
      }
    };

    // Handle redirects
    let explanation = explanations[concept];
    if (explanation && explanation.redirect) {
      explanation = explanations[explanation.redirect];
    }

    if (explanation) {
      return {
        message: `📚 **${explanation.title}**\n\n${explanation.explanation}`,
        type: 'explanation',
        suggestions: explanation.examples,
        data: { concept, title: explanation.title }
      };
    }

    // Fallback for unknown concepts — ask Ollama
    try {
      const llmAvailable = await ollama.isAvailable();
      if (llmAvailable) {
        const answer = await ollama.answerQuestion(`Explain "${concept || query}" in the context of business data and company research.`);
        if (answer) {
          return {
            message: answer,
            type: 'explanation',
            suggestions: ['What is scraping?', 'What is OpenCorporates?', 'Search for a company'],
          };
        }
      }
    } catch (err) {
      console.warn('[AI Assistant] Ollama explain fallback error:', err.message);
    }

    return {
      message: `I'd love to explain "${query}" to you, but I'm specialized in company research and data extraction.\n\n` +
        `I can explain terms like:\n` +
        `• Scraping/Web scraping\n` +
        `• OpenCorporates\n` +
        `• Companies House\n` +
        `• API\n` +
        `• Contact information\n` +
        `• Location filtering\n\n` +
        `Or ask me to help you find company information instead!`,
      type: 'explanation',
      suggestions: ['What is scraping?', 'What is OpenCorporates?', 'Search for a company'],
    };
  }

  /**
   * Provide suggestions and ideas
   */
  _provideSuggestions(intent, context) {
    const suggestions = {
      popular: [
        "🔥 Search for Fortune 500 companies",
        "🇬🇧 Explore UK tech startups in London",
        "🌍 Find global companies in specific industries",
        "📊 Compare major competitors (e.g., Apple vs Samsung)",
        "📞 Get contact information for potential clients"
      ],
      byIndustry: [
        "🚗 Search automotive companies (Tesla, Ford, BMW)",
        "💻 Find tech giants (Google, Microsoft, Apple)",
        "🏦 Explore financial institutions (HSBC, JPMorgan)",
        "🛒 Discover retail chains (Walmart, Tesco, Amazon)",
        "⚡ Research energy companies (Shell, BP, ExxonMobil)"
      ],
      byLocation: [
        "🇺🇸 Companies in Silicon Valley, California",
        "🇬🇧 Businesses in London's financial district",
        "🇯🇵 Japanese technology firms in Tokyo",
        "🇩🇪 German manufacturers in Munich",
        "🇮🇳 IT companies in Bangalore, India"
      ],
      advanced: [
        "🔍 Scrape company websites for lead generation",
        "📈 Track competitor information and contacts",
        "🌐 Build a database of companies in your target market",
        "💼 Find companies for partnership opportunities",
        "📧 Collect contact emails for outreach campaigns"
      ]
    };

    const allSuggestions = [
      ...suggestions.popular,
      ...suggestions.byIndustry,
      ...suggestions.byLocation,
      ...suggestions.advanced
    ];

    const randomSuggestions = [];
    const categories = Object.keys(suggestions);
    
    // Pick 2 from each category
    categories.forEach(category => {
      const items = suggestions[category];
      const shuffled = items.sort(() => 0.5 - Math.random());
      randomSuggestions.push(...shuffled.slice(0, 2));
    });

    return {
      message: `💡 **Here are some ideas for what you can do:**\n\n` +
        randomSuggestions.slice(0, 8).join('\n') +
        `\n\n**Or try these commands:**\n` +
        `• "Search for [company name]"\n` +
        `• "Find companies in [city/country]"\n` +
        `• "Get contact info for [company]"\n` +
        `• "Scrape [website URL]"\n` +
        `• "Compare [company A] and [company B]"\n\n` +
        `What would you like to explore?`,
      type: 'suggestions',
      suggestions: [
        "Search for Tesla",
        "Companies in London",
        "Contact info for Apple",
        "What can you do?"
      ],
      data: { allSuggestions }
    };
  }

  /**
   * Handle conversational queries with intelligence — powered by Llama 3.2
   */
  async _handleConversation(intent, history) {
    const { query } = intent.params;
    const lowerQuery = query.toLowerCase();

    // Check for common conversational patterns
    if (lowerQuery.includes('thank') || lowerQuery.includes('thanks')) {
      return {
        message: "You're welcome! Happy to help. Is there anything else you'd like to know about companies or data extraction?",
        type: 'conversational',
        suggestions: ["Search another company", "What can you do?", "Give me ideas"]
      };
    }

    if (lowerQuery.includes('yes') || lowerQuery.includes('yeah') || lowerQuery.includes('sure')) {
      // Check previous context
      if (history.length > 0) {
        const lastMsg = history[history.length - 1];
        if (lastMsg.role === 'assistant' && lastMsg.content.includes('Would you like')) {
          return {
            message: "Great! What specifically would you like me to do?",
            type: 'conversational',
            suggestions: ["Get details", "Show contact info", "Search another company"]
          };
        }
      }
      return {
        message: "Awesome! What would you like me to help you with?",
        type: 'conversational',
        suggestions: ["Search for a company", "Get help", "Give me ideas"]
      };
    }

    if (lowerQuery.includes('no') || lowerQuery.includes('nope')) {
      return {
        message: "No problem! What else can I help you with?",
        type: 'conversational',
        suggestions: ["Search companies", "What can you do?", "Give me ideas"]
      };
    }

    // Provide intelligent fallback — use Ollama LLM
    try {
      const llmAvailable = await ollama.isAvailable();
      if (llmAvailable) {
        const answer = await ollama.answerQuestion(query || intent.raw || '');
        if (answer) {
          return {
            message: answer,
            type: 'conversational',
            suggestions: ['Search for a company', 'What can you do?', 'Give me ideas'],
          };
        }
      }
    } catch (err) {
      console.warn('[AI Assistant] Ollama fallback error:', err.message);
    }

    return {
      message: `I'm here to help you find and research companies! I can:\n\n` +
        `🔍 Search for any company worldwide\n` +
        `📞 Get contact information (emails, phones, websites)\n` +
        `🌐 Scrape company websites for data\n` +
        `📍 Filter companies by location\n` +
        `📊 Compare different companies\n` +
        `💡 Give you ideas and suggestions\n\n` +
        `Try asking me something like:\n` +
        `• "Search for Tesla"\n` +
        `• "What is scraping?"\n` +
        `• "Give me some ideas"\n` +
        `• "Find companies in London"`,
      type: 'conversational',
      suggestions: ['Search for a company', 'What is scraping?', 'Give me ideas', 'What can you do?'],
    };
  }

  /**
   * Get conversation history
   */
  _getHistory(sessionId) {
    if (!this.conversations.has(sessionId)) {
      this.conversations.set(sessionId, []);
    }
    return this.conversations.get(sessionId);
  }

  /**
   * Create default response
   */
  _createDefaultResponse() {
    return {
      message: "I can help you with that! What would you like me to do?",
      type: 'default',
      suggestions: ["Search companies", "Get help", "Show capabilities"]
    };
  }

  /**
   * Create error response
   */
  _createErrorResponse(error) {
    return {
      message: `Oops! Something went wrong: ${error.message}. Please try again or ask for help.`,
      type: 'error',
      error: error.message,
      suggestions: ["Try again", "Get help", "Search something else"]
    };
  }

  /**
   * Clear conversation history
   */
  clearHistory(sessionId) {
    this.conversations.delete(sessionId);
    console.log(`[AI] Cleared history for session: ${sessionId}`);
  }
}

module.exports = new EnhancedAIAssistant();
