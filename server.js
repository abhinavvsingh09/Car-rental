const express = require('express');
const app = express();


app.use(express.json());
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON payload.' });
  }
  next();
});


app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  next();
});


let records = [];
let nextId = 1;


const VALID_ENUMS = ['SEDAN', 'SUV', 'TRUCK', 'COUPE', 'VAN', 'AVAILABLE', 'RENTED', 'MAINTENANCE'];


function extractRecordFields(body) {
  return {
    text1: body.text1 !== undefined ? body.text1 : body.make,
    text2: body.text2 !== undefined ? body.text2 : body.model,
    amount: body.amount !== undefined ? body.amount : (body.dailyRate !== undefined ? body.dailyRate : body.price),
    count: body.count !== undefined ? body.count : (body.seats !== undefined ? body.seats : body.year),
    enumVal: body.enum !== undefined ? body.enum : (body.category !== undefined ? body.category : body.status),
    flag: body.flag !== undefined ? body.flag : (body.isAvailable !== undefined ? body.isAvailable : body.available),
    code: body.code !== undefined ? body.code : (body.vin !== undefined ? body.vin : body.registrationNumber)
  };
}


function validateRecord(data, isPatch = false, currentId = null) {
  const errors = [];
  const { text1, text2, amount, count, enumVal, flag, code } = extractRecordFields(data);

  if (!isPatch && Object.keys(data).length === 0) {
    return ['Request body cannot be empty.'];
  }

  
  if (!isPatch || text1 !== undefined) {
    if (text1 === undefined || typeof text1 !== 'string') {
      errors.push('text1/make is required and must be a string.');
    } else if (text1.trim().length < 2) {
      errors.push('text1/make must be at least 2 characters long.');
    }
  }


  if (!isPatch || text2 !== undefined) {
    if (text2 === undefined || typeof text2 !== 'string' || text2.trim() === '') {
      errors.push('text2/model is required and must be a non-empty string.');
    }
  }

  
  if (!isPatch || amount !== undefined) {
    if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
      errors.push('amount/dailyRate is required and must be a number greater than 0.');
    }
  }


  if (!isPatch || count !== undefined) {
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
      errors.push('count/seats/year must be an integer >= 0.');
    }
  }

  
  if (!isPatch || enumVal !== undefined) {
    if (typeof enumVal !== 'string' || !VALID_ENUMS.includes(enumVal.toUpperCase())) {
      errors.push(`enum/category must be one of: ${VALID_ENUMS.join(', ')}`);
    }
  }

 
  if (!isPatch || flag !== undefined) {
    if (typeof flag !== 'boolean') {
      errors.push('flag/isAvailable must be a boolean (true or false).');
    }
  }

 
  if (code !== undefined) {
    const duplicate = records.find(r => r.code === code && r.id !== currentId);
    if (duplicate) {
      errors.push(`Unique constraint violated for code: ${code}`);
    }
  }

  return errors;
}


function parseValidId(idParam) {
  if (!/^\d+$/.test(idParam)) {
    return null;
  }
  return parseInt(idParam, 10);
}


const router = express.Router();

router.post('/', (req, res) => {
  const errors = validateRecord(req.body, false);
  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join(' ') });
  }

  const { text1, text2, amount, count, enumVal, flag, code } = extractRecordFields(req.body);

  const newRecord = {
    ...req.body,
    id: nextId++,
    text1: typeof text1 === 'string' ? text1.trim() : text1,
    text2: typeof text2 === 'string' ? text2.trim() : text2,
    amount,
    count,
    enum: typeof enumVal === 'string' ? enumVal.toUpperCase() : enumVal,
    flag: Boolean(flag)
  };

  if (code) newRecord.code = code;

  records.push(newRecord);
  return res.status(201).json(newRecord);
});


router.get('/', (req, res) => {
  let {
    page = '1',
    limit = '10',
    sort,
    order = 'asc',
    search,
    flag,
    minAmount,
    maxAmount,
    min,
    max,
    enum: enumFilter,
    status,
    category
  } = req.query;

  // Validate pagination numbers
  const pageNum = Number(page);
  const limitNum = Number(limit);

  if (!Number.isInteger(pageNum) || pageNum <= 0) {
    return res.status(400).json({ error: 'page must be a positive integer >= 1' });
  }
  if (!Number.isInteger(limitNum) || limitNum <= 0 || limitNum > 50) {
    return res.status(400).json({ error: 'limit must be an integer between 1 and 50' });
  }

  // Validate amount ranges
  const minVal = minAmount !== undefined ? Number(minAmount) : (min !== undefined ? Number(min) : null);
  const maxVal = maxAmount !== undefined ? Number(maxAmount) : (max !== undefined ? Number(max) : null);

  if (minVal !== null && isNaN(minVal)) {
    return res.status(400).json({ error: 'min amount filter must be a valid number' });
  }
  if (maxVal !== null && isNaN(maxVal)) {
    return res.status(400).json({ error: 'max amount filter must be a valid number' });
  }
  if (minVal !== null && maxVal !== null && minVal > maxVal) {
    return res.status(400).json({ error: 'min amount cannot be greater than max amount' });
  }

  // Validate sort field & order
  const validSortFields = ['id', 'text1', 'text2', 'make', 'model', 'amount', 'dailyRate', 'price', 'count', 'seats', 'year'];
  if (sort && !validSortFields.includes(sort)) {
    return res.status(400).json({ error: `Invalid sort field: ${sort}` });
  }
  if (order && !['asc', 'desc'].includes(order.toLowerCase())) {
    return res.status(400).json({ error: `Invalid sort order: ${order}` });
  }

  let result = [...records];


  const targetEnum = enumFilter || status || category;
  if (targetEnum) {
    result = result.filter(r => {
      const val = (r.enum || r.status || r.category || '').toUpperCase();
      return val === targetEnum.toUpperCase();
    });
  }


  if (flag !== undefined) {
    if (flag !== 'true' && flag !== 'false') {
      return res.status(400).json({ error: 'flag filter must be "true" or "false"' });
    }
    const boolFlag = flag === 'true';
    result = result.filter(r => (r.flag !== undefined ? r.flag === boolFlag : r.isAvailable === boolFlag));
  }

  
  if (minVal !== null) {
    result = result.filter(r => (r.amount !== undefined ? r.amount : r.dailyRate) >= minVal);
  }
  if (maxVal !== null) {
    result = result.filter(r => (r.amount !== undefined ? r.amount : r.dailyRate) <= maxVal);
  }

  
  if (search !== undefined) {
    const term = search.trim().toLowerCase();
    if (term.length > 0) {
      result = result.filter(r => {
        const t1 = (r.text1 || r.make || '').toLowerCase();
        const t2 = (r.text2 || r.model || '').toLowerCase();
        return t1.includes(term) || t2.includes(term);
      });
    }
  }

  
  if (sort) {
    const isDesc = order.toLowerCase() === 'desc';
    result.sort((a, b) => {
      let valA = a[sort];
      let valB = b[sort];
      if (typeof valA === 'string') {
        return isDesc ? valB.localeCompare(valA) : valA.localeCompare(valB);
      }
      return isDesc ? (valB - valA) : (valA - valB);
    });
  }

  
  const total = result.length;
  const totalPages = Math.ceil(total / limitNum) || 0;
  const startIndex = (pageNum - 1) * limitNum;
  const paginatedData = result.slice(startIndex, startIndex + limitNum);

  return res.status(200).json({
    data: paginatedData,
    page: pageNum,
    limit: limitNum,
    total,
    totalPages
  });
});


router.get('/:id', (req, res) => {
  const id = parseValidId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'Invalid ID format. Must be an integer.' });
  }

  const record = records.find(r => r.id === id);
  if (!record) {
    return res.status(404).json({ error: `Record with id ${id} not found.` });
  }

  return res.status(200).json(record);
});


router.put('/:id', (req, res) => {
  const id = parseValidId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'Invalid ID format.' });
  }

  const index = records.findIndex(r => r.id === id);
  if (index === -1) {
    return res.status(404).json({ error: `Record with id ${id} not found.` });
  }

  const errors = validateRecord(req.body, false, id);
  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join(' ') });
  }

  const { text1, text2, amount, count, enumVal, flag, code } = extractRecordFields(req.body);

  const updated = {
    ...req.body,
    id, // Ensure ID remains immutable
    text1: typeof text1 === 'string' ? text1.trim() : text1,
    text2: typeof text2 === 'string' ? text2.trim() : text2,
    amount,
    count,
    enum: typeof enumVal === 'string' ? enumVal.toUpperCase() : enumVal,
    flag: Boolean(flag)
  };

  if (code) updated.code = code;

  records[index] = updated;
  return res.status(200).json(updated);
});


router.patch('/:id', (req, res) => {
  const id = parseValidId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'Invalid ID format.' });
  }

  const record = records.find(r => r.id === id);
  if (!record) {
    return res.status(404).json({ error: `Record with id ${id} not found.` });
  }

  if (req.body && Object.keys(req.body).length > 0) {
    const errors = validateRecord(req.body, true, id);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join(' ') });
    }
  }

  
  for (const [key, value] of Object.entries(req.body)) {
    if (key !== 'id') {
      record[key] = value;
    }
  }

  return res.status(200).json(record);
});


router.delete('/:id', (req, res) => {
  const id = parseValidId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'Invalid ID format.' });
  }

  const index = records.findIndex(r => r.id === id);
  if (index === -1) {
    return res.status(404).json({ error: `Record with id ${id} not found.` });
  }

  records.splice(index, 1);
  return res.status(204).end();
});


app.use('/api/cars', router);
app.use('/cars', router);
app.use('/', router);


app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});


const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
