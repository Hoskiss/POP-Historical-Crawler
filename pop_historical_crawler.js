
var fs = require('fs'),
    $ = require('cheerio'),
    http = require('http'),
    Promise = require('bluebird'),
    iconv = require('iconv-lite'),
    Set = require("collections/set"),
    BufferHelper = require('bufferhelper');

// for debug
function printOut(content) {
    console.log(content);
}

// copy obj
function copy(ori_o) {
    var copy_obj = Object.create(Object.getPrototypeOf(ori_o));
    var propNames = Object.getOwnPropertyNames(ori_o);

    propNames.forEach(function(name) {
        var desc = Object.getOwnPropertyDescriptor(ori_o, name);
        Object.defineProperty(copy_obj, name, desc);
    });

    return copy_obj;
}

// req_options can be string or object
function requestPromise(req_options) {
    // Return a new promise.
    return new Promise(function(resolve, reject) {

        var check_options = {};
        if("object" === typeof req_options) {
            check_options = copy(req_options);
        } else if ("string" === typeof req_options) {
            check_options = {
                host: "www.fnpn.gov.tw",
                method: 'GET'
            };
            check_options.path = req_options;
        } else {
            reject("Error: Invalid request options " + req_options);
        }

        var req = http.request(check_options, function(res) {
            var bufferhelper = new BufferHelper();
            // big-5 conding
            // res.setEncoding('utf-8');
            res.on('data', function (chunk) {
                bufferhelper.concat(chunk);
            });

            res.on('end', function () {
                if(200 === res.statusCode) {
                    resolve(iconv.decode(bufferhelper.toBuffer(), 'Big5'));
                } else {
                    reject("Error network response: " + res.statusCode);
                }
            });
        });

        req.on('error', function(err) {
            reject("Error: " + err.message);
        });

        req.end();
    });
}

function parseTimestampLinks(raw_page) {
    var link_set = new Set();
    var every_link_pattern = 'a[href^="/ct/CFT.php?page=CFTBidResult&area=N000&CFT_ID="]';
    $(raw_page).find(every_link_pattern).each(function () {
        link_set.add($(this).attr('href'));
    });
    var every_links = link_set.toArray();

    var start_end_timestamp_pattern = 'tr td.table-border-yellow div.text-grey-10';
    var category_announce_bid_list = [];
    $(raw_page).find(start_end_timestamp_pattern).each(function () {
        category_announce_bid_list.push($(this).text());
    });
    var start_end_timestamp = (category_announce_bid_list[category_announce_bid_list.length-1].trim() +
                               "_" + category_announce_bid_list[2].trim());
    start_end_timestamp = start_end_timestamp.replace(/-/g, "_");

    var timestamp_links = {};
    timestamp_links.timestamp = start_end_timestamp;
    timestamp_links.every_links = every_links;
    return timestamp_links;
}

function initOutputFile(timestamp_links) {
    this.output_file_path = "./north_historical_" + timestamp_links.timestamp + ".csv";
    // remove origin "details" item
    // var title_row = "id, address, area, category, base price, sale price, competitors count, details, notes";
    var title_row = "id, address, area, category, base price, sale price, competitors count, notes";
    fs.writeFileSync(this.output_file_path, title_row + "\n");

    return timestamp_links.every_links;
}

function crawlerLinks(every_links) {
    var this_output_file_path = this.output_file_path;
    // links array => options array
    return every_links.map(
        requestPromise).reduce(function(sequence, request_link) {
            return sequence.then(function() {
                return request_link;
            }).bind({
                output_file_path: this_output_file_path
            }).then(
                collectEveryItems
            ).then(
                rearrangeEveryItems
            );
        }, Promise.resolve());
}

function collectEveryItems(raw_page) {
    var total_elems_list = [];
    var every_items_pattern = 'tr td.table-border-yellow';
    $(raw_page).find(every_items_pattern).each(function () {
        total_elems_list.push($(this).text().replace(/\s/gm, ""));
    });

    var year_group_pattern = 'td.text-11-sub-green div.12-oran-warning';
    var year_group = $(raw_page).find(year_group_pattern).text().match(/(\d+)/g);
    // bid started date (year+month+day)
    var group_id = year_group.slice(5, 8).join("") + "_";

    if(1 === year_group[1].length) {
        group_id += ("0"+year_group[1]+"_");
    } else {
        group_id += (year_group[1]+"_");
    }

    var id_elems = {};
    id_elems.g_id = group_id;
    id_elems.elems = total_elems_list;
    return id_elems;
}

function rearrangeEveryItems(id_elems) {
    var tabular_total_elems = [];
    var title_row = "id, address, area, category, base price, sale price, competitors count, details, notes";
    tabular_total_elems.push(title_row.split(","));

    var elem_index = 0,
        curr_id = 0,
        curr_row_index = 1;
    var north_address_regex = /^.+[縣|市]/;

    while(elem_index < id_elems.elems.length) {

        if(north_address_regex.test(id_elems.elems[elem_index])) {
            // update id
            var previous_elem = id_elems.elems[elem_index-1];
            if( !isNaN(previous_elem) && parseInt(previous_elem, 10)>curr_id ) {
                curr_id = parseInt(previous_elem, 10);
            }

            var each_row = [];
            var row_id = "N" + id_elems.g_id;
            if (1 === curr_id.toString().length) {
                row_id += ("0"+curr_id.toString());
            } else {
                row_id += curr_id.toString();
            }
            each_row.push(row_id);
            each_row.push(" " + id_elems.elems[elem_index]);

            var item_count = 2;
            ++elem_index;

            while( !north_address_regex.test(id_elems.elems[elem_index]) &&
                   elem_index<id_elems.elems.length) {
                // Not need to add id item in list
                if (isNaN(id_elems.elems[elem_index]) ||
                          !north_address_regex.test(id_elems.elems[elem_index+1])) {

                    ++item_count;
                    // add "" to keep , in item (for csv)
                    if(/,/.test(id_elems.elems[elem_index])) {
                        id_elems.elems[elem_index] = "\""+id_elems.elems[elem_index]+"\"";
                    }

                    // 5, 6, 7, 8, 9 => base price, sale price, competitors count, details, notes
                    // copy prev existing value of same id item if self is blank
                    if(!id_elems.elems[elem_index] && item_count > 4 &&
                       each_row[0] === tabular_total_elems[curr_row_index-1][0]) {
                        id_elems.elems[elem_index] = tabular_total_elems[curr_row_index-1][item_count-1];
                    }

                    each_row.push(" " +id_elems.elems[elem_index]);

                }
                ++elem_index;
            }

            // fill blank item
            while(item_count < title_row.split(",").length) {
                ++item_count;

                // 5, 6, 7, 8, 9 => base price, sale price, competitors count, details, notes
                // copy prev existing value of same id item if self is blank
                if(item_count > 4 && each_row[0] === tabular_total_elems[curr_row_index-1][0]) {
                    each_row.push(tabular_total_elems[curr_row_index-1][item_count-1]);
                } else {
                    each_row.push(" ");
                }
            }

            tabular_total_elems.push(each_row);
            ++curr_row_index;

            // remove origin "details" item
            // error with each_row.splice(7, 1)
            var to_write_row = each_row.slice(0, 7);
            to_write_row.push(each_row[8]);
            fs.appendFileSync(this.output_file_path, to_write_row.toString()+"\n");
        } else {
            ++elem_index;
        }
    }
}

function parseOnePageToCSV(page_options) {
    requestPromise(page_options).bind({
        output_file_path: ""}).then(
        parseTimestampLinks
    ).then(
        initOutputFile
    ).then(
        crawlerLinks
    ).catch(function(err) {
        console.log(err);
    });
}

function calcuEveryPageLinks(raw_page) {
    var last_page_pattern = 'img[alt^="最後一頁"]';
    var last_page_link = $(raw_page).find(last_page_pattern).parent().attr('href');

    // "/ct/CFT.php?page=CFTMain2&startItem=40"
    var last_start_item = last_page_link.match(/startItem=(\d+)/)[1];
    var every_page_links = [];
    // 10 items per page
    for (var offset=0; offset<=parseInt(last_start_item, 10); offset+=10) {
        every_page_links.push("/ct/CFT.php?page=CFTMain2&startItem=" + offset.toString());
    }

    return every_page_links;
}

var init_options = {
    host: "www.fnpn.gov.tw",
    path: "/ct/CFT.php?page=CFTMain2&area=N000",
    method: 'GET'
};

requestPromise(init_options).then(
    calcuEveryPageLinks
).then(function(every_page_links) {
    every_page_links.map(parseOnePageToCSV);
}).catch(function(err) {
    console.log(err);
});
