/**
 * AI Assistant Service
 * Helps users find and collect company information
 */

const companiesHouse = require('./companiesHouse');
const openCorporates = require('./openCorporates');
const googlePlaces = require('./googlePlacesService');
const webScraper = require('./webScraperService');

class AIAssistantService {
  /**
   * Process user request and collect company information
   */
  async processRequest(userMessage, context = {}) {
    try {
      console.log('[AI Assistant] Processing request:', userMessage);

      // Detect intent from user message
      const intent = this._detectIntent(userMessage);
      
      let response = {
        message: '',
        data: null,
        suggestions: [],
        type: intent
      };

      switch (intent) {
        case 'search_company':
          response = await this._handleCompanySearch(userMessage, context);
          break;
        
        case 'get_contact_info':
          response = await this._handleContactInfo(userMessage, context);
          break;
        
        case 'scrape_website':
          response = await this._handleWebsiteScrape(userMessage, context);
          break;
        
        case 'help':
          response = this._handleHelp();
          break;
        
        default:
          response.message = "I can help you find company information. Try asking me to:\n" +
            "- Search for a company\n" +
            "- Get contact information\n" +
            "- Scrape a company website\n" +
            "- Find companies in a specific location";
          response.suggestions = [
            "Search for Tesco in UK",
            "Get contact info for Shell",
            "Find tech companies in London"
          ];
      }

      return response;
    } catch (error) {
      console.error('[AI Assistant] Error:', error.message);
      return {
        message: "Sorry, I encountered an error processing your request.",
        error: error.message
      };
    }
  }

  /**
   * Detect user intent from message
   */
  _detectIntent(message) {
    const lower = message.toLowerCase();
    
    if (lower.includes('search') || lower.includes('find') || lower.includes('look for')) {
      return 'search_company';
    }
    
    if (lower.includes('contact') || lower.includes('email') || lower.includes('phone')) {
      return 'get_contact_info';
    }
    
    if (lower.includes('scrape') || lower.includes('website') || lower.includes('crawl')) {
      return 'scrape_website';
    }
    
    if (lower.includes('help') || lower.includes('what can you do')) {
      return 'help';
    }
    
    return 'general';
  }

  /**
   * Handle company search requests
   */
  async _handleCompanySearch(message, context) {
    // Extract company name and location from message
    const companyName = this._extractCompanyName(message);
    const location = this._extractLocation(message);

    if (!companyName) {
      return {
        message: "Which company would you like to search for?",
        type: 'search_company',
        suggestions: ["Search for Google", "Find Apple Inc", "Look for Microsoft"]
      };
    }

    try {
      let results = [];

      // Search in appropriate registry
      if (location && (location.includes('uk') || location.includes('britain'))) {
        const ukResults = await companiesHouse.searchCompanies(companyName, { limit: 5 });
        results = ukResults.companies || [];
      } else {
        // Try Google Places
        const place = await googlePlaces.searchPlace(companyName, location);
        if (place) {
          results = [{
            name: place.name,
            address: place.formatted_address,
            source: 'Google Places'
          }];
        }
      }

      return {
        message: `Found ${results.length} result(s) for "${companyName}"${location ? ` in ${location}` : ''}`,
        data: results,
        type: 'search_company',
        suggestions: [
          "Get contact information",
          "Search another company",
          "Scrape company website"
        ]
      };
    } catch (error) {
      return {
        message: `Error searching for "${companyName}": ${error.message}`,
        type: 'search_company'
      };
    }
  }

  /**
   * Handle contact information requests
   */
  async _handleContactInfo(message, context) {
    const companyName = this._extractCompanyName(message);

    if (!companyName) {
      return {
        message: "Which company's contact information do you need?",
        type: 'get_contact_info'
      };
    }

    try {
      // Try to find company and enrich with Places data
      const place = await googlePlaces.searchPlace(companyName);
      
      if (place) {
        const details = await googlePlaces.getPlaceDetails(place.place_id);
        
        return {
          message: `Here's the contact information for ${companyName}:`,
          data: {
            website: details?.website,
            phone: details?.formatted_phone_number,
            address: details?.formatted_address,
            rating: details?.rating
          },
          type: 'get_contact_info'
        };
      }

      return {
        message: `Couldn't find contact information for "${companyName}". Try searching for the company first.`,
        type: 'get_contact_info'
      };
    } catch (error) {
      return {
        message: `Error getting contact info: ${error.message}`,
        type: 'get_contact_info'
      };
    }
  }

  /**
   * Handle website scraping requests
   */
  async _handleWebsiteScrape(message, context) {
    const url = this._extractURL(message);

    if (!url) {
      return {
        message: "Please provide a website URL to scrape.",
        type: 'scrape_website'
      };
    }

    try {
      const data = await webScraper.scrapeCompanyWebsite(url);
      
      return {
        message: `Successfully scraped ${url}`,
        data: {
          emails: data?.emails || [],
          phones: data?.phones || [],
          socialMedia: data?.socialMedia || {},
          description: data?.description
        },
        type: 'scrape_website',
        suggestions: ["Search another company", "Get more details"]
      };
    } catch (error) {
      return {
        message: `Error scraping website: ${error.message}`,
        type: 'scrape_website'
      };
    }
  }

  /**
   * Handle help requests
   */
  _handleHelp() {
    return {
      message: "I'm your AI assistant for finding company information!\n\n" +
        "I can help you:\n" +
        "• Search for companies globally\n" +
        "• Find contact information (email, phone)\n" +
        "• Get company details from registries\n" +
        "• Scrape company websites for data\n" +
        "• Discover social media profiles\n\n" +
        "Just ask me in natural language!",
      type: 'help',
      suggestions: [
        "Search for Microsoft in USA",
        "Get contact info for Tesla",
        "Find restaurants in London"
      ]
    };
  }

  /**
   * Extract company name from message
   */
  _extractCompanyName(message) {
    // Remove common words
    const cleaned = message
      .replace(/search\s+(for\s+)?/gi, '')
      .replace(/find\s+/gi, '')
      .replace(/look\s+for\s+/gi, '')
      .replace(/company\s+/gi, '')
      .replace(/information\s+(for|about)\s+/gi, '')
      .replace(/\s+in\s+\w+$/gi, '')
      .trim();
    
    return cleaned || null;
  }

  /**
   * Extract location from message
   */
  _extractLocation(message) {
    const locationMatch = message.match(/\s+in\s+(\w+(?:\s+\w+)?)/i);
    return locationMatch ? locationMatch[1] : null;
  }

  /**
   * Extract URL from message
   */
  _extractURL(message) {
    const urlMatch = message.match(/(https?:\/\/[^\s]+)/);
    return urlMatch ? urlMatch[1] : null;
  }
}

module.exports = new AIAssistantService();
