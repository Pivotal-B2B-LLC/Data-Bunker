curl -s -X POST http://localhost:5000/api/scraper/people \
  -H "Content-Type: application/json" \
  -d '{"people":[{"fullName":"Sarah Johnson","jobTitle":"Director of Marketing","company":"Acme Corp","location":"London, England, United Kingdom","profileUrl":"https://linkedin.com/in/sarahjohnson","connectionDegree":"2nd"},{"fullName":"James Smith","jobTitle":"CEO","company":"Tech Ventures Ltd","location":"Manchester, England, United Kingdom","profileUrl":"https://linkedin.com/in/jamessmith-ceo"}],"filters":{"keywords":"Director","companySize":"51-200","activeFilters":["London","Director"]},"pageNum":1,"source":"linkedin"}' \
  | python3 -m json.tool
