"use strict";

function PlaneObject(icao) {
	// Info about the plane
        this.icao      = icao;
        this.flight    = null;
	this.squawk    = null;
	this.selected  = false;
        this.category  = null;

	// Basic location information
        this.altitude  = null;
        this.speed     = null;
        this.track     = null;
        this.position  = null;
        this.sitedist  = null;

	// Data packet numbers
	this.messages  = null;
        this.rssi      = null;

        // Track history as a series of line segments
        this.track_linesegs = [];
        this.history_size = 0;

	// When was this last updated (receiver timestamp)
        this.last_message_time = null;
        this.last_position_time = null;

        // When was this last updated (seconds before last update)
        this.seen = null;
        this.seen_pos = null;

        // Display info
        this.visible = true;
        this.marker = null;
        this.icon = { type: MarkerIcons.generic,
			          fillOpacity: 0.9,
		              fillColor: "none" };

        // request metadata
        this.registration = null;
        this.icaotype = null;
        getAircraftData(this.icao).done(function(data) {
                if ("r" in data) {
                        this.registration = data.r;
                }

                if ("t" in data) {
                        this.icaotype = data.t;
                }

                if (this.selected) {
		        refreshSelected();
                }
        }.bind(this));
}

// Appends data to the running track so we can get a visual tail on the plane
// Only useful for a long running browser session.
PlaneObject.prototype.updateTrack = function(estimate_time) {
        var here = this.position;
        if (!here)
                return;

        if (this.track_linesegs.length == 0) {
                // Brand new track
                //console.log(this.icao + " new track");
                var newseg = { track : [here,here],
                               line : null,
                               head_update : this.last_position_time,
                               tail_update : this.last_position_time,
                               estimated : false,
                               ground : (this.altitude === "ground")
                             };
                this.track_linesegs.push(newseg);
                this.history_size += 2;
                return;
        }
        
        var lastseg = this.track_linesegs[this.track_linesegs.length - 1];
        var lastpos = lastseg.track[lastseg.track.length - 1];
        var elapsed = (this.last_position_time - lastseg.head_update);
        
        var new_data = (here !== lastpos);
        var est_track = (elapsed > estimate_time);
        var ground_track = (this.altitude === "ground");
        
        if (!new_data)
                return false;
        
        if (est_track) {
                if (!lastseg.estimated) {
                        // >5s gap in data, create a new estimated segment
                        //console.log(this.icao + " switching to estimated");
                        this.track_linesegs.push({ track : [lastpos, here],
                                                   line : null,
                                                   head_update : this.last_position_time,
                                                   estimated : true });
                        this.history_size += 2;
                        return true;
                }
                
                // Append to ongoing estimated line
                //console.log(this.icao + " extending estimated (" + lastseg.track.getLength() + ")");
                lastseg.track.push(here);
                lastseg.head_update = this.last_position_time;
                this.history_size++;
                return true;
        }
        
        if (lastseg.estimated) {
                // We are back to good data.
                //console.log(this.icao + " switching to good track");
                this.track_linesegs.push({ track : [lastpos, here],
                                           line : null,
                                           head_update : this.last_position_time,
                                           tail_update : this.last_position_time,
                                           estimated : false,
                                           ground : (this.altitude === "ground") });
                this.history_size += 2;
                return true;
        }
        
        if ( (lastseg.ground && this.altitude !== "ground") ||
             (!lastseg.ground && this.altitude === "ground") ) {
                //console.log(this.icao + " ground state changed");
                // Create a new segment as the ground state changed.
                // assume the state changed halfway between the two points
				var midpointLat = lastpos.lat + here.lat / 2;
				var midpointLon = lastpos.lon + here.lon / 2;
                var midpoint = [midpointLat, midpointLon];
                lastseg.track.push(midpoint);
                this.track_linesegs.push({ track : [midpoint,here,here],
                                           line : null,
                                           head_update : this.last_position_time,
                                           tail_update : this.last_position_time,
                                           estimated : false,
                                           ground : (this.altitude === "ground") });
                this.history_size += 4;
                return true;
        }
        
        // Add more data to the existing track.
        // We only retain some historical points, at 5+ second intervals,
        // plus the most recent point
        if (this.last_position_time - lastseg.tail_update >= 5) {
                // enough time has elapsed; retain the last point and add a new one
                //console.log(this.icao + " retain last point");
                lastseg.track.push(here);
                lastseg.tail_update = lastseg.head_update;
                this.history_size ++;
        } else {
                // replace the last point with the current position
                lastseg.track[lastseg.track.length-1] = here;
        }
        lastseg.head_update = this.last_position_time;
        return true;
};

// This is to remove the line from the screen if we deselect the plane
PlaneObject.prototype.clearLines = function() {
        for (var i = 0; i < this.track_linesegs.length; ++i) {
                var seg = this.track_linesegs[i];
                if (seg.line !== null) {
                        Map.removeLayer(seg.line);
                        seg.line = null;
                }
        }
};

PlaneObject.prototype.getMarkerIconType = function() {
        var lookup = {
                'A1' : MarkerIcons.light,
                'A2' : MarkerIcons.medium,
                'A3' : MarkerIcons.medium,
                'A5' : MarkerIcons.heavy,
                'A7' : MarkerIcons.rotorcraft

        };

        if (this.category === null || !(this.category in lookup))
                return MarkerIcons.generic
        else
                return lookup[this.category];
}

PlaneObject.prototype.getMarkerColor = function() {
        // Emergency squawks override everything else
        if (this.squawk in SpecialSquawks)
                return SpecialSquawks[this.squawk].markerColor;

        var h, s, l;

        if (this.altitude === null) {
                h = ColorByAlt.unknown.h;
                s = ColorByAlt.unknown.s;
                l = ColorByAlt.unknown.l;
        } else if (this.altitude === "ground") {
                h = ColorByAlt.ground.h;
                s = ColorByAlt.ground.s;
                l = ColorByAlt.ground.l;
        } else {
                s = ColorByAlt.air.s;
                l = ColorByAlt.air.l;

                // find the pair of points the current altitude lies between,
                // and interpolate the hue between those points
                var hpoints = ColorByAlt.air.h;
                h = hpoints[0].val;
                for (var i = hpoints.length-1; i >= 0; --i) {
                        if (this.altitude > hpoints[i].alt) {
                                if (i == hpoints.length-1) {
                                        h = hpoints[i].val;
                                } else {
                                        h = hpoints[i].val + (hpoints[i+1].val - hpoints[i].val) * (this.altitude - hpoints[i].alt) / (hpoints[i+1].alt - hpoints[i].alt)
                                }
                                break;
                        }
                }
        }

        // If we have not seen a recent position update, change color
        if (this.seen_pos > 15) {
                h += ColorByAlt.stale.h;
                s += ColorByAlt.stale.s;
                l += ColorByAlt.stale.l;
        }

        // If this marker is selected, change color
        if (this.selected){
                h += ColorByAlt.selected.h;
                s += ColorByAlt.selected.s;
                l += ColorByAlt.selected.l;
        }

        if (h < 0) {
                h = (h % 360) + 360;
        } else if (h >= 360) {
                h = h % 360;
        }

        if (s < 5) s = 5;
        else if (s > 95) s = 95;

        if (l < 5) l = 5;
        else if (l > 95) l = 95;

        return 'hsl(' + h.toFixed(0) + ',' + s.toFixed(0) + '%,' + l.toFixed(0) + '%)'
}

PlaneObject.prototype.updateIcon = function() {
        var col = this.getMarkerColor();
        var type = this.getMarkerIconType();
        var weight = this.selected ? 2 : 1;
		var angle = (this.track === null ? 0 : this.track);
        
        if (col === this.icon.fillColor && weight === this.icon.strokeWeight && type == this.icon.type && angle === this.marker.options.angle)
                return false;  // no changes
        
        this.icon.fillColor = col;
        this.icon.strokeWeight = weight;
        this.icon.type = type;
        if (this.marker) {
                this.marker.setIcon(new L.DivIcon({
					iconSize: [32, 32],
					iconAnchor: [16, 16],
					className: "",
					html: "<svg viewBox=\"0 0 64 64\"><path d=\"" + this.icon.type.path + "\" style=\"fill: " + this.icon.fillColor + "; stroke-width:" + this.icon.strokeWeight + "; stroke: black\" /></svg>"
								}));
				this.marker.options.angle = angle;
		}
        return true;
};

// Update our data
PlaneObject.prototype.updateData = function(receiver_timestamp, data) {
	// Update all of our data
	this.messages	= data.messages;
        this.rssi       = data.rssi;
	this.last_message_time = receiver_timestamp - data.seen;
        
        if (typeof data.altitude !== "undefined")
		this.altitude	= data.altitude;
        if (typeof data.vert_rate !== "undefined")
		this.vert_rate	= data.vert_rate;
        if (typeof data.speed !== "undefined")
		this.speed	= data.speed;
        if (typeof data.track !== "undefined")
                this.track	= data.track;
        if (typeof data.lat !== "undefined") {
                this.position   = new L.LatLng(data.lat, data.lon);
                this.last_position_time = receiver_timestamp - data.seen_pos;

                if (SitePosition !== null) {
                        this.sitedist = SitePosition.distanceTo(this.position);
                }
        }
        if (typeof data.flight !== "undefined")
		this.flight	= data.flight;
        if (typeof data.squawk !== "undefined")
		this.squawk	= data.squawk;
        if (typeof data.category !== "undefined")
                this.category	= data.category;
};

PlaneObject.prototype.updateTick = function(receiver_timestamp, last_timestamp) {
        // recompute seen and seen_pos
        this.seen = receiver_timestamp - this.last_message_time;
        this.seen_pos = (this.last_position_time === null ? null : receiver_timestamp - this.last_position_time);
        
	// If no packet in over 58 seconds, clear the plane.
	if (this.seen > 58) {
                if (this.visible) {
                        //console.log("hiding " + this.icao);
                        this.clearMarker();
                        this.visible = false;
			if (SelectedPlane == this.icao)
                                selectPlaneByHex(null,false);
                }
	} else {
                this.visible = true;
                if (this.position !== null) {
			if (this.updateTrack(receiver_timestamp - last_timestamp + 5)) {
                                this.updateLines();
                                this.updateMarker(true);
                        } else { 
                                this.updateMarker(false); // didn't move
                        }
                }
	}
};

PlaneObject.prototype.clearMarker = function() {
	if (this.marker) {
		Map.removeLayer(this.marker);
        this.marker.off('click');
		this.marker = null;
	}
};

// Update our marker on the map
PlaneObject.prototype.updateMarker = function(moved) {
        if (!this.visible) {
                this.clearMarker();
                return;
        }
        
	if (this.marker) {
                if (moved)
			this.marker.setLatLng(this.position);
                this.updateIcon();
	} else {
                this.updateIcon();
		this.marker = new L.RotatedMarker(this.position, {
			icon: new L.DivIcon({
				iconSize: [32, 32],
				iconAnchor: [16, 16],
				className: "",
				html: "<svg viewBox=\"0 0 64 64\"><path d=\"" + this.icon.type.path + "\" style=\"fill: " + this.icon.fillColor + "; stroke-width:" + this.icon.strokeWeight + "; stroke: black\" /></svg>"
			}),
			visible: true,
			angle: (this.track === null ? 0 : this.track)
		});

		if (this.position) {
			this.marker.addTo(Map);
		}
                
		// Trap clicks for this marker.
		this.marker.on('click', selectPlaneByHex.bind(undefined,this.icao,false));
		this.marker.on('dblclick', selectPlaneByHex.bind(undefined,this.icao,true));
	}
        
	// Setting the marker title
        var title = (this.flight === null || this.flight.length == 0) ? this.icao : (this.flight+' ('+this.icao+')');
        if (title !== this.marker.title)
	        this.marker.title = title;
};

// Update our planes tail line,
PlaneObject.prototype.updateLines = function() {
        if (!this.selected)
                return;
        
        for (var i = 0; i < this.track_linesegs.length; ++i) {
                var seg = this.track_linesegs[i];
                if (seg.line === null) {
                        // console.log("create line for seg " + i + " with " + seg.track.getLength() + " points" + (seg.estimated ? " (estimated)" : ""));
                        // for (var j = 0; j < seg.track.getLength(); j++) {
                        //         console.log("  point " + j + " at " + seg.track.getAt(j).lat() + "," + seg.track.getAt(j).lng());
                        // }
                        
                        if (seg.estimated) {
                                seg.line = new L.Polyline(seg.track, {
                                        strokeOpacity: 1,
                                        color: '#804040',
                                        weight: 2,
										dashArray: "5, 5"
                                        }).addTo(Map);
                        } else {
                                seg.line = new L.Polyline(seg.track, {
					strokeOpacity: 1.0,
					color: (seg.ground ? '#408040' : '#000000'),
					weight: 3 }).addTo(Map);
						}
                }
        }
};

PlaneObject.prototype.destroy = function() {
        this.clearLines();
        this.clearMarker();
};
