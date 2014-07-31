
var $ = require('cheerio'),
    fs = require('fs'),
    iconv = require('iconv-lite'),
    BufferHelper = require('bufferhelper'),
    http = require('http'),
    Promise = require('promise'),
    Set = require("collections/set");

var output_file_path = "./north_history_tmp.csv";
// remove origin "details" item
// var title_row = "id, address, area, category, base price, sale price, competitors count, details, notes";
var title_row = "id, address, area, category, base price, sale price, competitors count, notes";
fs.writeFileSync(output_file_path, title_row+"\n");

var options = {
    host: "www.fnpn.gov.tw",
    path: "/ct/CFT.php?page=CFTMain2&area=N000",
    method: 'GET'
};

function requestPromise(options) {
    // Return a new promise.
    return new Promise(function(resolve, reject) {

        var req = http.request(options, function(res) {
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

var every_links = [];

function parseEveryLinks(raw_page) {
    var link_set = new Set();
    var every_link_pattern = 'a[href^="/ct/CFT.php?page=CFTBidResult&area=N000&CFT_ID="]';
    $(raw_page).find(every_link_pattern).each(function () {
        link_set.add($(this).attr('href'));
    });
    every_links = link_set.toArray();

    return every_links;
}

function printOut(content) {
    console.log(content);
}

function transformOptions(link) {
    var each_options = {};
    for (var key in options) {
        each_options[key] = options[key];
    }
    each_options.path = link;
    // console.log(each_options);
    return each_options;
}

function collectEveryItems(raw_page) {
    var total_elems_list = [];
    var every_items_pattern = 'tr td.table-border-yellow';
    $(raw_page).find(every_items_pattern).each(function () {
        total_elems_list.push($(this).text().replace(/\s/gm, ""));
    });

    return total_elems_list;
}

function rearrangeEveryItems(total_elems) {
    var tabular_total_elems = [];
    var title_row = "id, address, area, category, base price, sale price, competitors count, details, notes";
    tabular_total_elems.push(title_row.split(","));

    var elem_index = 0,
        curr_id = 0,
        curr_row_index = 1;
    var north_address_regex = /^.+[縣|市]/;

    while(elem_index < total_elems.length) {

        if(north_address_regex.test(total_elems[elem_index])) {
            // update id
            var previous_elem = total_elems[elem_index-1];
            if( !isNaN(previous_elem) && parseInt(previous_elem, 10)>curr_id ) {
                curr_id = parseInt(previous_elem, 10);
            }

            var each_row = [];
            each_row.push(curr_id.toString());
            each_row.push(" " + total_elems[elem_index]);

            var item_count = 2;
            ++elem_index;

            while( !north_address_regex.test(total_elems[elem_index]) &&
                   elem_index<total_elems.length) {
                // Not need to add id item in list
                if (isNaN(total_elems[elem_index]) ||
                          !north_address_regex.test(total_elems[elem_index+1])) {

                    ++item_count;
                    // add "" to keep , in item (for csv)
                    if(/,/.test(total_elems[elem_index])) {
                        total_elems[elem_index] = "\""+total_elems[elem_index]+"\"";
                    }

                    // 5, 6, 7, 8, 9 => base price, sale price, competitors count, details, notes
                    // copy prev existing value of same id item if self is blank
                    if(!total_elems[elem_index] && item_count > 4 &&
                       each_row[0] === tabular_total_elems[curr_row_index-1][0]) {
                        total_elems[elem_index] = tabular_total_elems[curr_row_index-1][item_count-1];
                    }

                    each_row.push(" " +total_elems[elem_index]);

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
            fs.appendFileSync(output_file_path, to_write_row.toString()+"\n");
        } else {
            ++elem_index;
        }
    }
}

function crawlerLinks(every_links) {
    // links array => options array
    return every_links.map(
        transformOptions).map(
        requestPromise).reduce(function(sequence, request_link) {
            return sequence.then(function() {
                return request_link;
            }).then(
                collectEveryItems
            ).then(
                rearrangeEveryItems
            );
        }, Promise.resolve());
}

requestPromise(options).then(
    parseEveryLinks
).then(
    crawlerLinks
).catch(function(err) {
    console.log(err);
});

