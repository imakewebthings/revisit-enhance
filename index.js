var _ = require('lodash')
var restify = require('restify')
var dataUriToBuffer = require('data-uri-to-buffer')
var readimage = require('readimage')
var writegif = require('writegif')
var server = restify.createServer()
var port = process.env.PORT || 7000

var Pixel = function(r, g, b, a) {
  this.r = r
  this.g = g
  this.b = b
  this.a = a
}

Pixel.prototype.toArray = function() {
  return [this.r, this.g, this.b, this.a]
}

var PixelGrid = function(pixels, width, height) {
  this.grid = []
  this.width = width
  this.height = height
  for (var i = 0; i < height; i++) {
    this.grid[i] = pixels.slice(width * i, width * (i+1))
  }
}

PixelGrid.prototype.split = function(callback) {
  var topLeft = [], topRight = [], bottomLeft = [], bottomRight = []
  var ySplit = Math.floor(this.height / 2)
  var xSplit = Math.floor(this.width / 2)
  var y, x

  for (y = 0; y < ySplit; y++) {
    for (x = 0; x < xSplit; x++) {
      topLeft.push(this.grid[y][x])
    }
  }

  for (y = 0; y < ySplit; y++) {
    for (x = xSplit; x < this.width; x++) {
      topRight.push(this.grid[y][x])
    }
  }

  for (y = ySplit; y < this.height; y++) {
    for (x = 0; x < xSplit; x++) {
      bottomLeft.push(this.grid[y][x])
    }
  }

  for (y = ySplit; y < this.height; y++) {
    for (x = xSplit; x < this.width; x++) {
      bottomRight.push(this.grid[y][x])
    }
  }

  return [
    new PixelGrid(topLeft, xSplit, ySplit),
    new PixelGrid(topRight, this.width - xSplit, ySplit),
    new PixelGrid(bottomLeft, xSplit, this.height - ySplit),
    new PixelGrid(bottomRight, this.width - xSplit, this.height - ySplit)
  ]
}

PixelGrid.prototype.average = function() {
  var rTotal = 0, gTotal = 0, bTotal = 0, aTotal = 0
  var pixelCount = this.height * this.width
  var rAvg, gAvg, bAvg, aAvg

  for (var y = 0; y < this.height; y++) {
    for (var x = 0; x < this.width; x++) {
      rTotal += this.grid[y][x].r
      gTotal += this.grid[y][x].g
      bTotal += this.grid[y][x].b
      aTotal += this.grid[y][x].a
    }
  }

  rAvg = rTotal / pixelCount
  gAvg = gTotal / pixelCount
  bAvg = bTotal / pixelCount
  aAvg = aTotal / pixelCount

  for (var y = 0; y < this.height; y++) {
    for (var x = 0; x < this.width; x++) {
      this.grid[y][x].r = rAvg
      this.grid[y][x].g = gAvg
      this.grid[y][x].b = bAvg
      this.grid[y][x].a = aAvg
    }
  }
}

PixelGrid.prototype.toArray = function() {
  return _.flatten(_.invoke(_.flatten(this.grid), 'toArray'))
}

function createPixelGrid(frame, width, height) {
  var pixelArray = []
  var j
  for (j = 0, len = frame.data.length; j < len; j += 4) {
    pixelArray.push(new Pixel(
      frame.data[j],
      frame.data[j+1],
      frame.data[j+2],
      frame.data[j+3]
    ))
  }
  for (; j < width * height * 4; j+=4) {
    pixelArray.push(new Pixel(0, 0, 0, 0))
  }
  return new PixelGrid(pixelArray, width, height)
}

function fillGif(image) {
  var base = image.frames[0].data
  image.frames[0].delay = 100
  _.times(9, function(i) {
    var buf = new Buffer(base.length)
    base.copy(buf)
    image.frames[i] = {
      delay: 100,
      data: buf
    }
  })
}

function scale(val, fromMin, fromMax, toMin, toMax) {
  return ((toMax - toMin) * (val - fromMin) / (fromMax - fromMin)) + toMin
}

var methods = {
  enhance: function(image, callback) {
    var longEdge = Math.max(image.width, image.height)
    var splitMax = Math.ceil(Math.log(longEdge) / Math.LN2)
    if (image.frames.length === 1) {
      fillGif(image)
    }
    for(var i = 0, len = image.frames.length; i < len; i++) {
      var grid = createPixelGrid(image.frames[i], image.width, image.height)
      var grids = [grid]
      var splitCount = Math.floor(scale(i, 0, len, 1, splitMax))
      _.times(Math.floor(scale(i, 0, len, 1, splitMax)), function() {
        grids = _.flatten(grids, function(g) {
          return g.split()
        })
      })
      _.invoke(grids, 'average')
      image.frames[i].data = new Buffer(grid.toArray())
    }
    callback(null, image)
  }
}

server.use(restify.acceptParser(server.acceptable))
server.use(restify.bodyParser({
  mapParams: false
}))

Object.keys(methods).forEach(function(method) {
  server.head('/' + method, function(req, res, next) {
    res.send(200)
  })

  server.post('/' + method + '/service', function(req, res, next) {
    var buffer = dataUriToBuffer(req.body.content.data)

    function sendResult(err, result) {
      if (err) {
        conso
        return res.json(req.body)
      }
      var data = 'data:image/gif;base64,' + result.toString('base64')
      req.body.content.data = data
      res.json(req.body)
    }

    function createGif(err, image) {
      if (err) {
        return res.json(req.body)
      }
      writegif(image, sendResult)
    }

    function processImage(err, image) {
      if (err) {
        return res.json(req.body)
      }
      methods[method](image, createGif)
    }

    if (buffer.type.indexOf('image/') < 0) {
      return res.json(req.body)
    }

    readimage(buffer, processImage)
  })
})

server.listen(port)
console.log('Service running on port %s', port)
